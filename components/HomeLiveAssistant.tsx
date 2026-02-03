import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { GoogleGenAI, LiveServerMessage, Modality, StartSensitivity, EndSensitivity, createPartFromUri, Type } from '@google/genai';
import { ResearchProject, UploadedFile, UserProfile } from '../types';
import { storageService } from '../services/storageService';
import { contextService, ChatMessage as ContextChatMessage } from '../services/contextService';
import { createPcmBlob, decode, decodeAudioData } from '../services/audioUtils';
import { getFileSearchStoreName, uploadFileToGemini, isUserSubscribed, ComputerUseSession, performComputerUseTask, confirmComputerUseAction, cancelComputerUseSession, generateImage, editImageWithReferences, generateVeoVideo, generatePodcastScript, generatePodcastAudio, ImageReference } from '../services/geminiService';
import { createVideoFromImageUrl, pollVideoUntilComplete, downloadVideoBlob } from '../services/soraService';
import { authFetch } from '../services/authFetch';
import ComputerUseViewer from './ComputerUseViewer';


interface ExtendedChatMessage extends ContextChatMessage {
  isGenerating?: boolean;
  imageUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
  computerUseSession?: ComputerUseSession;
  computerUseGoal?: string;
}

interface HomeLiveAssistantProps {
  projects: ResearchProject[];
  scheduledPosts?: Array<{
    id: string;
    scheduledAt: number;
    platforms: string[];
    textContent: string;
    status: string;
    projectId?: string;
  }>;
  isDarkMode: boolean;
  onClose: () => void;
}

type AssistantMode = 'chat' | 'voice';
type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

const buildSearchTokens = (value: string) =>
  (value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(token => token.length > 2);

const scoreByTokens = (text: string, tokens: string[]) => {
  if (!tokens.length) return 0;
  const haystack = (text || '').toLowerCase();
  let score = 0;
  tokens.forEach(token => {
    if (!token) return;
    if (haystack.includes(token)) {
      score += token.length >= 6 ? 2 : 1;
    }
  });
  return score;
};

const uploadToBlob = async (blob: Blob, filename: string): Promise<string> => {
  try {
    const { upload } = await import('@vercel/blob/client');
    const newBlob = await upload(filename, blob, {
      access: 'public',
      handleUploadUrl: '/api/media?op=upload-token',
    });
    return newBlob.url;
  } catch (error) {
    console.error('Blob upload failed:', error);
    throw error;
  }
};

const dataUrlToBlob = (dataUrl: string): Blob => {
  const arr = dataUrl.split(',');
  const mimeMatch = arr[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/png';
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
};

const ensureImageRef = async (input: string): Promise<ImageReference> => {
  if (input.startsWith('data:')) {
    const arr = input.split(',');
    const mimeMatch = arr[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/png';
    return { base64: arr[1], mimeType: mime };
  } else {
    // It's a URL (e.g. Vercel Blob), fetch it and convert to base64
    const res = await fetch(input);
    if (!res.ok) throw new Error(`Failed to fetch image from URL: ${input}`);
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1];
        resolve({ base64, mimeType: blob.type || 'image/png' });
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
};

export const HomeLiveAssistant: React.FC<HomeLiveAssistantProps> = ({
  projects,
  scheduledPosts = [],
  isDarkMode,
  onClose,
}) => {
  const [mode, setMode] = useState<AssistantMode>('chat');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [messages, setMessages] = useState<ExtendedChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcriptBuffer, setTranscriptBuffer] = useState('');
  const [userTranscriptBuffer, setUserTranscriptBuffer] = useState('');

  const [pendingAttachments, setPendingAttachments] = useState<
    Array<{ id: string; file: File; status: 'uploading' | 'ready' | 'error'; uploaded?: UploadedFile; error?: string; previewUrl?: string }>
  >([]);
  const attachmentsInputRef = useRef<HTMLInputElement | null>(null);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [activeComputerUseMessageId, setActiveComputerUseMessageId] = useState<string | null>(null);
  const [lastGeneratedAsset, setLastGeneratedAsset] = useState<{ type: 'image' | 'video'; url: string; publicUrl?: string } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const outputNodeRef = useRef<GainNode | null>(null);

  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    storageService.getUserProfile().then(p => setUserProfile(p)).catch(() => setUserProfile(null));
  }, []);

  // Check subscription status for Computer Use feature
  useEffect(() => {
    isUserSubscribed().then(setIsSubscribed).catch(() => setIsSubscribed(false));
  }, []);

  /**
   * Detect if the user's message requires browser automation.
   * Only triggers for Pro users on specific task patterns.
   */
  const shouldUseComputerUse = useCallback((message: string): { needed: boolean; goal?: string; url?: string } => {
    if (!isSubscribed) return { needed: false };

    const lower = message.toLowerCase();

    // Patterns that indicate browser automation is needed
    const browserPatterns = [
      // Shopping/pricing research
      /\b(find|search|look up|browse|compare)\b.*\b(price|pricing|cost|deal|discount|cheapest|best deal)/i,
      /\b(shop|shopping|buy|purchase)\b.*\b(on|at|from)\b.*\b(amazon|google|ebay|walmart|target)/i,
      // Real-time data
      /\b(check|get|find|look up)\b.*\b(live|current|real.?time|latest)\b.*\b(stock|weather|news|score)/i,
      // Form filling
      /\b(fill out|fill in|complete|submit)\b.*\b(form|application|registration)/i,
      // Web navigation with action
      /\b(go to|navigate to|open|visit)\b.*\.(com|org|net|io)\b.*\b(and|then)\b/i,
      // Explicit browser request
      /\b(use (the )?browser|open (the )?browser|browser automation|automate|scrape|screenshot)\b/i,
    ];

    for (const pattern of browserPatterns) {
      if (pattern.test(message)) {
        // Extract URL if present
        const urlMatch = message.match(/https?:\/\/[^\s]+|www\.[^\s]+|\b([a-z0-9-]+\.(com|org|net|io|co))\b/i);
        const url = urlMatch ? (urlMatch[0].startsWith('http') ? urlMatch[0] : `https://${urlMatch[0]}`) : undefined;

        return { needed: true, goal: message, url };
      }
    }

    return { needed: false };
  }, [isSubscribed]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const addMessage = useCallback(
    (role: 'user' | 'model', text: string): string => {
      const trimmedText = text.trim();
      if (!trimmedText) return '';

      let newId = crypto.randomUUID();

      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last && last.role === role && (last.text || '').trim() === trimmedText) {
          return prev;
        }

        const newMessage: ExtendedChatMessage = {
          id: newId,
          role,
          text: trimmedText,
          timestamp: Date.now(),
        };
        return [...prev, newMessage];
      });

      return newId;
    },
    []
  );

  const isUploadingAttachments = pendingAttachments.some(a => a.status === 'uploading');
  const readyAttachments = pendingAttachments.filter(a => a.status === 'ready' && a.uploaded);

  const clearAttachments = useCallback(() => {
    setPendingAttachments(prev => {
      for (const a of prev) {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      }
      return [];
    });
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setPendingAttachments(prev => {
      const toRemove = prev.find(p => p.id === id);
      if (toRemove?.previewUrl) URL.revokeObjectURL(toRemove.previewUrl);
      return prev.filter(p => p.id !== id);
    });
  }, []);

  const handlePickAttachments = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const selected = Array.from(files);

    const newEntries = selected.map(file => ({
      id: crypto.randomUUID(),
      file,
      status: 'uploading' as const,
      previewUrl: file.type?.startsWith('image/') ? URL.createObjectURL(file) : undefined,
    }));

    setPendingAttachments(prev => [...prev, ...newEntries]);

    for (const entry of newEntries) {
      try {
        const uploaded = await uploadFileToGemini(entry.file, entry.file.name);
        setPendingAttachments(prev =>
          prev.map(p => (p.id === entry.id ? { ...p, status: 'ready', uploaded } : p))
        );
      } catch (e: any) {
        setPendingAttachments(prev =>
          prev.map(p => (p.id === entry.id ? { ...p, status: 'error', error: String(e?.message || e) } : p))
        );
      }
    }
  };

  const connectVoice = async () => {
    setError(null);
    setConnectionStatus('connecting');

    try {
      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      const ai = new GoogleGenAI({ apiKey });

      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      audioContextRef.current = outputCtx;
      inputContextRef.current = inputCtx;

      const outputNode = outputCtx.createGain();
      outputNode.connect(outputCtx.destination);
      outputNodeRef.current = outputNode;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const systemInstruction = contextService.getAccountSystemInstruction(projects, 'voice', scheduledPosts, userProfile);

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction,
          outputAudioTranscription: {},
          inputAudioTranscription: {},
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
          },
          thinkingConfig: {
            includeThoughts: true,
            thinkingBudget: 4096,
          },
          realtimeInputConfig: {
            automaticActivityDetection: {
              disabled: false,
              startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_LOW,
              endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
              prefixPaddingMs: 20,
              silenceDurationMs: 500,
            },
          },
        },
        callbacks: {
          onopen: () => {
            setConnectionStatus('connected');

            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);

            scriptProcessor.onaudioprocess = e => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createPcmBlob(inputData);
              sessionPromise.then(session => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };

            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
          },
          onmessage: async (msg: LiveServerMessage) => {
            console.log('Home Live API message:', msg);
            const { serverContent } = msg;
            const clientContent = (msg as any).clientContent;

            // Accumulate user input transcription, mirroring ProjectLiveAssistant
            const inputText = clientContent?.inputTranscription?.text
              || serverContent?.inputTranscription?.text;
            if (inputText) {
              setUserTranscriptBuffer(prev => prev + inputText);
            }

            // When the user turn is complete, commit the buffered input to messages
            if (clientContent?.turnComplete) {
              setUserTranscriptBuffer(prev => {
                const trimmed = prev.trim();
                if (trimmed) {
                  addMessage('user', trimmed);
                }
                return '';
              });
            }

            if (serverContent?.interrupted) {
              sourcesRef.current.forEach(s => s.stop());
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setIsSpeaking(false);
            }

            // Accumulate model output transcription chunks in a buffer
            if (serverContent?.outputTranscription?.text) {
              const text = serverContent.outputTranscription.text;
              setTranscriptBuffer(prev => prev + text);
            }

            // When the model turn completes, flush the transcript buffer into a single message
            if (serverContent?.turnComplete) {
              setTranscriptBuffer(prev => {
                const trimmed = prev.trim();
                if (trimmed) {
                  addMessage('model', trimmed);
                }
                return '';
              });
            }

            const base64Audio = serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio && audioContextRef.current && outputNodeRef.current) {
              setIsSpeaking(true);
              const ctx = audioContextRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);

              const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(outputNodeRef.current);

              source.addEventListener('ended', () => {
                sourcesRef.current.delete(source);
                if (sourcesRef.current.size === 0) setIsSpeaking(false);
              });

              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              sourcesRef.current.add(source);
            }
          },
          onclose: () => {
            setConnectionStatus('disconnected');
            setIsSpeaking(false);
          },
          onerror: err => {
            console.error('Home Voice API Error', err);
            setError('Voice connection error. Please try again.');
            setConnectionStatus('error');
          },
        },
      });

      sessionRef.current = await sessionPromise;
    } catch (e) {
      console.error('Failed to connect home voice assistant:', e);
      setError('Failed to initialize voice. Check microphone permissions.');
      setConnectionStatus('error');
    }
  };

  const disconnectVoice = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    if (inputContextRef.current) {
      inputContextRef.current.close();
      inputContextRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    sourcesRef.current.forEach(s => s.stop());
    sourcesRef.current.clear();
    sessionRef.current = null;
    setConnectionStatus('disconnected');
    setIsSpeaking(false);
  };

  const handleSendMessage = async () => {
    if ((!inputText.trim() && readyAttachments.length === 0) || isProcessing) return;
    if (isUploadingAttachments) {
      setError('Please wait for attachments to finish uploading.');
      return;
    }

    const userMessage = inputText.trim();
    setIsProcessing(true);
    setInputText('');
    addMessage('user', userMessage);

    if (mode === 'voice' && sessionRef.current) {
      try {
        let textForLive = userMessage;
        if (readyAttachments.length > 0) {
          const lines = readyAttachments.map(a => {
            const u = a.uploaded;
            return u ? `- ${u.displayName || a.file.name} (${u.mimeType || a.file.type || 'unknown'}): ${u.uri}` : `- ${a.file.name}`;
          });
          textForLive += `\n\n[User attached files:\n${lines.join('\n')}\nUse them as context if possible.]`;
        }
        sessionRef.current.sendClientContent({ turns: textForLive, turnComplete: true });
        clearAttachments();
      } catch (e) {
        console.error('Failed to send text to home voice session:', e);
        setError('Failed to send message over live connection.');
      }
      return;
    }

    // Check if Computer Use (browser automation) is needed
    const computerUseCheck = shouldUseComputerUse(userMessage);
    if (computerUseCheck.needed && computerUseCheck.goal) {
      // Create a message with Computer Use viewer
      const cuMessageId = crypto.randomUUID();
      setMessages(prev => [
        ...prev,
        {
          id: cuMessageId,
          role: 'model',
          text: '🤖 Starting browser automation...',
          timestamp: Date.now(),
          computerUseGoal: computerUseCheck.goal,
          computerUseSession: undefined, // Will be populated when viewer mounts
        },
      ]);
      setActiveComputerUseMessageId(cuMessageId);
      clearAttachments();
      return;
    }

    setError(null);

    try {
      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      const ai = new GoogleGenAI({ apiKey });
      const systemInstruction = contextService.getAccountSystemInstruction(projects, 'chat', scheduledPosts, userProfile);

      const conversationHistory = messages.map(msg => ({
        role: msg.role,
        parts: [{ text: msg.text }],
      }));

      const userParts: any[] = [{ text: userMessage }];
      for (const att of readyAttachments) {
        const u = att.uploaded;
        if (!u?.uri) continue;
        userParts.push({
          text: `Attached file: ${u.displayName || att.file.name} (${u.mimeType || att.file.type || 'unknown'}). Use it as context for the user's request.`
        });
        userParts.push(createPartFromUri(u.uri, u.mimeType || att.file.type || 'application/octet-stream'));
      }

      conversationHistory.push({
        role: 'user',
        parts: userParts,
      });

      clearAttachments();

      const streamingMessageId = crypto.randomUUID();
      setMessages(prev => [
        ...prev,
        {
          id: streamingMessageId,
          role: 'model',
          text: '',
          timestamp: Date.now(),
          isGenerating: true,
        },
      ]);

      // Define Generation Tools
      const generateImageTool = {
        name: 'generate_image',
        description: 'Generate an image based on a prompt. Use this when the user asks to "create an image", "generate a picture", or "draw" something.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            prompt: {
              type: Type.STRING,
              description: 'Detailed description of the image to generate.'
            },
            aspectRatio: {
              type: Type.STRING,
              description: 'Aspect ratio of the image (e.g. "1:1", "16:9", "9:16"). Default to 1:1 unless specified.',
              enum: ['1:1', '16:9', '9:16', '4:3', '3:4']
            }
          },
          required: ['prompt']
        }
      };

      const generateVideoTool = {
        name: 'generate_video',
        description: 'Generate a video based on a prompt. Use this when the user asks to "create a video", "make a video", or "animate" something.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            prompt: {
              type: Type.STRING,
              description: 'Description of the video content and motion.'
            }
          },
          required: ['prompt']
        }
      };

      const generatePodcastTool = {
        name: 'generate_podcast',
        description: 'Generate a podcast episode (audio) about a specific topic. Use this when the user asks to "make a podcast", "create a podcast episode", or "record a podcast".',
        parameters: {
          type: Type.OBJECT,
          properties: {
            topic: {
              type: Type.STRING,
              description: 'The main topic or subject of the podcast.'
            },
            style: {
              type: Type.STRING,
              description: 'Style of the podcast (e.g. "conversational", "educational", "interview").',
              enum: ['conversational', 'educational', 'interview', 'debate']
            }
          },
          required: ['topic']
        }
      };

      // Edit Image Tool
      const editImageTool = {
        name: 'edit_image',
        description: 'Edit an existing image based on a text prompt. Use when user wants to modify, change, or transform an existing image. Requires the image URL.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            imageUrl: {
              type: Type.STRING,
              description: 'URL of the image to edit.'
            },
            editPrompt: {
              type: Type.STRING,
              description: 'Description of the edits to make (e.g., "add a sunset", "remove background", "make it look vintage").'
            },
            useLastGenerated: {
              type: Type.BOOLEAN,
              description: 'Set to true to edit the most recently generated image. Use when user says "edit this image" or "change the image".'
            }
          },
          required: ['editPrompt']
        }
      };

      // Generate Video from Image Tool
      const generateVideoFromImageTool = {
        name: 'generate_video_from_image',
        description: 'Generate a video starting from an existing image with motion. Use when user wants to animate an image or create video from a still image.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            imageUrl: {
              type: Type.STRING,
              description: 'URL of the source image.'
            },
            motionPrompt: {
              type: Type.STRING,
              description: 'Description of the motion/animation to apply (e.g., "camera slowly zooms in", "leaves start blowing in the wind").'
            },
            useLastGenerated: {
              type: Type.BOOLEAN,
              description: 'Set to true to use the most recently generated image. Use when user says "animate this" or "make this into a video".'
            }
          },
          required: ['motionPrompt']
        }
      };

      // Generate PDF Tool
      const generatePdfTool = {
        name: 'generate_pdf',
        description: 'Generate a PDF document with formatted content. Use when user asks to create a PDF, document, or report.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            title: {
              type: Type.STRING,
              description: 'Title of the PDF document.'
            },
            content: {
              type: Type.STRING,
              description: 'The main content/body of the PDF in markdown format.'
            },
            style: {
              type: Type.STRING,
              description: 'Visual style of the PDF.',
              enum: ['professional', 'modern', 'minimal', 'colorful']
            }
          },
          required: ['title', 'content']
        }
      };

      // Get Connected Accounts Tool
      const getConnectedAccountsTool = {
        name: 'get_connected_accounts',
        description: 'Get the list of connected social media accounts. Use this BEFORE posting to get available pages/accounts.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            platform: {
              type: Type.STRING,
              description: 'Platform to check connections for.',
              enum: ['facebook', 'instagram', 'x', 'tiktok', 'youtube', 'linkedin', 'all']
            }
          },
          required: ['platform']
        }
      };

      // Post to Social Tool
      const postToSocialTool = {
        name: 'post_to_social',
        description: 'Post content to social media platforms. If not connected, tell user to connect in a project Social tab.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            platforms: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'Platforms to post to: facebook, instagram, x, tiktok, youtube, linkedin'
            },
            contentType: {
              type: Type.STRING,
              description: 'Type of content.',
              enum: ['text', 'image', 'video']
            },
            text: {
              type: Type.STRING,
              description: 'Caption or post text.'
            },
            mediaUrl: {
              type: Type.STRING,
              description: 'URL of media to post.'
            },
            useLastGenerated: {
              type: Type.BOOLEAN,
              description: 'Set to true to use the most recently generated image/video.'
            }
          },
          required: ['platforms', 'contentType']
        }
      };

      // Schedule Post Tool
      const schedulePostTool = {
        name: 'schedule_post',
        description: 'Schedule a social media post for later. Use when user says "schedule", "post at", "post tomorrow", etc.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            platforms: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'Platforms to schedule for: facebook, instagram, x, tiktok, youtube, linkedin'
            },
            scheduledAt: {
              type: Type.STRING,
              description: 'ISO 8601 datetime or natural language (e.g., "tomorrow at 2pm", "2025-12-24T14:00:00").'
            },
            contentType: {
              type: Type.STRING,
              description: 'Type of content.',
              enum: ['text', 'image', 'video']
            },
            text: {
              type: Type.STRING,
              description: 'Caption or post text.'
            },
            mediaUrl: {
              type: Type.STRING,
              description: 'URL of media to schedule.'
            },
            useLastGenerated: {
              type: Type.BOOLEAN,
              description: 'Set to true to use the most recently generated image/video.'
            }
          },
          required: ['platforms', 'scheduledAt', 'contentType']
        }
      };

      const tools: any[] = [
        {
          functionDeclarations: [
            generateImageTool,
            generateVideoTool,
            generatePodcastTool,
            editImageTool,
            generateVideoFromImageTool,
            generatePdfTool,
            getConnectedAccountsTool,
            postToSocialTool,
            schedulePostTool
          ]
        },
        { googleSearch: {} }
      ];

      try {
        const tokens = buildSearchTokens(userMessage);
        const ranked = (projects || [])
          .map(p => {
            const topics = (p.researchSessions || []).slice(-6).map(s => s.topic).join(' ');
            const haystack = `${p.name || ''} ${p.description || ''} ${topics}`;
            return { project: p, score: scoreByTokens(haystack, tokens) };
          })
          .sort((a, b) => b.score - a.score);

        const selected = ranked
          .filter(r => r.score > 0)
          .slice(0, 3)
          .map(r => r.project)
          .filter(p => !!p?.id);

        if (selected.length > 0) {
          const storeName = await getFileSearchStoreName();
          const ids = selected
            .map(p => String(p.id).replace(/"/g, ''))
            .filter(Boolean);

          if (storeName && ids.length > 0) {
            const filter = ids.map(id => `project_id="${id}"`).join(' OR ');
            tools.unshift({
              fileSearch: {
                fileSearchStoreNames: [storeName],
                metadataFilter: ids.length > 1 ? `(${filter})` : filter,
              }
            } as any);
          }
        }
      } catch (e) {
        console.warn('Failed to enable File Search for home assistant:', e);
      }

      const stream = await ai.models.generateContentStream({
        model: 'gemini-2.5-flash',
        contents: conversationHistory,
        config: {
          systemInstruction,
          temperature: 0.7,
          maxOutputTokens: 4096,
          tools,
          toolConfig: { functionCallingConfig: { mode: 'AUTO' as any } },
        },
      });

      let fullText = '';
      const aggregatedFunctionCalls: any[] = [];
      let latestGroundingMetadata: any = null;

      for await (const chunk of stream as any) {
        const candidate = chunk.candidates?.[0];
        if (!candidate) continue;

        if (candidate.groundingMetadata) {
          latestGroundingMetadata = candidate.groundingMetadata;
        }

        const parts = candidate.content?.parts || [];
        for (const part of parts) {
          if (part.text) {
            const textChunk: string = part.text;
            fullText += textChunk;
            setMessages(prev =>
              prev.map(msg =>
                msg.id === streamingMessageId
                  ? { ...msg, text: (msg.text || '') + textChunk }
                  : msg
              )
            );
          } else if (part.functionCall) {
            aggregatedFunctionCalls.push(part.functionCall);
          }
        }
      }

      // Handle Grounding
      try {
        const chunks = latestGroundingMetadata?.groundingChunks;
        if (Array.isArray(chunks) && chunks.length > 0) {
          const sources: string[] = [];
          chunks.forEach((c: any) => {
            const webTitle = c?.web?.title;
            const webUri = c?.web?.uri;
            if (webUri || webTitle) sources.push(webTitle ? `${webTitle} (${webUri || 'no url'})` : String(webUri));
          });
          if (sources.length > 0) {
            const deduped = Array.from(new Set(sources)).slice(0, 5);
            const citationBlock = `\n\nSources:\n${deduped.map(s => `- ${s}`).join('\n')}`;
            fullText += citationBlock;
            setMessages(prev =>
              prev.map(msg =>
                msg.id === streamingMessageId
                  ? { ...msg, text: (msg.text || '') + citationBlock }
                  : msg
              )
            );
          }
        }
      } catch (e) { console.warn('Grounding error', e); }

      // Handle Function Calls
      if (aggregatedFunctionCalls.length > 0) {
        console.log('Processing function calls:', aggregatedFunctionCalls);

        for (const fc of aggregatedFunctionCalls) {
          try {
            if (fc.name === 'generate_image') {
              const args = fc.args as any;
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + '\n\n🎨 Generating image...' } : m));
              const { imageDataUrl } = await generateImage(args.prompt, { aspectRatio: args.aspectRatio });
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text.replace('🎨 Generating image...', '☁️ Uploading to storage...') } : m));
              const blob = dataUrlToBlob(imageDataUrl);
              const vercelUrl = await uploadToBlob(blob, `generated-image-${Date.now()}.png`);
              setLastGeneratedAsset({ type: 'image', url: vercelUrl });
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? {
                ...m,
                imageUrl: vercelUrl,
                text: m.text.replace('☁️ Uploading to storage...', '✅ Image generated:')
              } : m));
            } else if (fc.name === 'generate_video') {
              const args = fc.args as any;
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + '\n\n🎥 Generating video (this may take a minute)...' } : m));
              // Use Veo (SoraModel.VEO) for best results
              const videoBlob = await generateVeoVideo(args.prompt, '16:9', 'speed');
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text.replace('🎥 Generating video (this may take a minute)...', '☁️ Uploading to storage...') } : m));
              const vercelUrl = await uploadToBlob(videoBlob, `veo-video-${Date.now()}.mp4`);
              setLastGeneratedAsset({ type: 'video', url: vercelUrl });
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? {
                ...m,
                videoUrl: vercelUrl,
                text: m.text.replace('☁️ Uploading to storage...', '✅ Video generated:')
              } : m));
            } else if (fc.name === 'generate_podcast') {
              const args = fc.args as any;
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + '\n\n🎙️ Generating podcast script and audio...' } : m));

              // 1. Generate Script (infer context from all projects)
              const accountCtx = contextService.buildAccountContext(projects);
              const script = await generatePodcastScript(
                args.topic || 'General Topic', // Title
                `Podcast about ${args.topic}`, // Desc
                [], // Summaries
                args.style || 'conversational',
                'short', // Duration
                [], // uploaded files
                accountCtx.fullContext // context
              );

              // 2. Generate Audio
              const { audioData, mimeType } = await generatePodcastAudio(script);
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text.replace('🎙️ Generating podcast script and audio...', '☁️ Uploading audio to storage...') } : m));
              const audioBlob = dataUrlToBlob(`data:${mimeType};base64,${audioData}`);
              const vercelUrl = await uploadToBlob(audioBlob, `podcast-${Date.now()}.mp3`);

              setMessages(prev => prev.map(m => m.id === streamingMessageId ? {
                ...m,
                audioUrl: vercelUrl,
                text: m.text.replace('☁️ Uploading audio to storage...', '✅ Podcast generated:')
              } : m));
            } else if (fc.name === 'edit_image') {
              const args = fc.args as any;
              const imageToEdit = args.useLastGenerated && lastGeneratedAsset?.type === 'image'
                ? lastGeneratedAsset.url
                : args.imageUrl;

              if (!imageToEdit) {
                setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + '\n\n❌ No image to edit. Please generate an image first or provide an image URL.' } : m));
              } else {
                setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + '\n\n🎨 Editing image...' } : m));
                // Convert URL to ImageReference format for editImageWithReferences
                const imageRef = await ensureImageRef(imageToEdit);
                const { imageDataUrl } = await editImageWithReferences(args.editPrompt, [imageRef]);
                setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text.replace('🎨 Editing image...', '☁️ Uploading to storage...') } : m));
                const blob = dataUrlToBlob(imageDataUrl);
                const vercelUrl = await uploadToBlob(blob, `edited-image-${Date.now()}.png`);
                setLastGeneratedAsset({ type: 'image', url: vercelUrl });
                setMessages(prev => prev.map(m => m.id === streamingMessageId ? {
                  ...m,
                  imageUrl: vercelUrl,
                  text: m.text.replace('☁️ Uploading to storage...', '✅ Image edited:')
                } : m));
              }
            } else if (fc.name === 'generate_video_from_image') {
              const args = fc.args as any;
              const sourceImage = args.useLastGenerated && lastGeneratedAsset?.type === 'image'
                ? lastGeneratedAsset.url
                : args.imageUrl;

              if (!sourceImage) {
                setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + '\n\n❌ No image to animate. Please generate or provide an image first.' } : m));
              } else {
                setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + '\n\n🎬 Generating video from image (this may take a minute)...' } : m));
                try {
                  const generation = await createVideoFromImageUrl({ prompt: args.motionPrompt || 'Animate this image with subtle motion', model: 'sora-2' }, sourceImage);
                  const completed = await pollVideoUntilComplete(generation.id);
                  const videoBlob = await downloadVideoBlob(completed.id);
                  setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text.replace('🎬 Generating video from image (this may take a minute)...', '☁️ Uploading to storage...') } : m));
                  const vercelUrl = await uploadToBlob(videoBlob, `sora-video-${Date.now()}.mp4`);
                  setLastGeneratedAsset({ type: 'video', url: vercelUrl });
                  setMessages(prev => prev.map(m => m.id === streamingMessageId ? {
                    ...m,
                    videoUrl: vercelUrl,
                    text: m.text.replace('☁️ Uploading to storage...', '✅ Video generated from image:')
                  } : m));
                } catch (err: any) {
                  setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text.replace('🎬 Generating video from image (this may take a minute)...', `❌ Video generation failed: ${err.message}`) } : m));
                }
              }
            } else if (fc.name === 'generate_pdf') {
              const args = fc.args as any;
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + '\n\n📄 Generating PDF...' } : m));
              try {
                const response = await authFetch('/api/pdf/generate', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    title: args.title,
                    content: args.content,
                    style: args.style || 'professional'
                  })
                });
                if (!response.ok) throw new Error('PDF generation failed');
                const blob = await response.blob();
                setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text.replace('📄 Generating PDF...', '☁️ Uploading PDF to storage...') } : m));
                const vercelUrl = await uploadToBlob(blob, `${args.title || 'document'}-${Date.now()}.pdf`);
                setMessages(prev => prev.map(m => m.id === streamingMessageId ? {
                  ...m,
                  text: m.text.replace('☁️ Uploading PDF to storage...', `✅ PDF generated: [Download PDF](${vercelUrl})`)
                } : m));
              } catch (err: any) {
                setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text.replace('📄 Generating PDF...', `❌ PDF generation failed: ${err.message}`) } : m));
              }
            } else if (fc.name === 'get_connected_accounts') {
              // Note: Social connections are managed per-project in the Social tab
              // From the Home assistant, we inform the user to check a project's Social tab
              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + '\n\n📱 To check and manage social account connections, please open a project and go to the Social tab. Social posting from the Home assistant requires accounts to be connected in a project first.' } : m));
            } else if (fc.name === 'post_to_social') {
              const args = fc.args as any;
              const platforms = args.platforms || [args.platform];
              const mediaUrl = args.useLastGenerated && lastGeneratedAsset ? lastGeneratedAsset.url : args.mediaUrl;

              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + `\n\n📤 Posting to ${platforms.join(', ')}...` } : m));

              try {
                const results: string[] = [];
                for (const platform of platforms) {
                  const response = await authFetch('/api/social/post', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      platform,
                      contentType: args.contentType,
                      text: args.text || '',
                      mediaUrl
                    })
                  });
                  const data = await response.json();
                  if (data.success) {
                    results.push(`✅ ${platform}: Posted successfully`);
                  } else if (data.error?.includes('not connected')) {
                    results.push(`⚠️ ${platform}: Not connected. Please connect in a project's Social tab.`);
                  } else {
                    results.push(`❌ ${platform}: ${data.error || 'Failed'}`);
                  }
                }
                setMessages(prev => prev.map(m => m.id === streamingMessageId ? {
                  ...m,
                  text: m.text.replace(`📤 Posting to ${platforms.join(', ')}...`, results.join('\n'))
                } : m));
              } catch (err: any) {
                setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text.replace(`📤 Posting to ${platforms.join(', ')}...`, `❌ Error posting: ${err.message}`) } : m));
              }
            } else if (fc.name === 'schedule_post') {
              const args = fc.args as any;
              const platforms = args.platforms || [];
              const mediaUrl = args.useLastGenerated && lastGeneratedAsset ? lastGeneratedAsset.url : args.mediaUrl;

              setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + `\n\n📅 Scheduling post for ${args.scheduledAt}...` } : m));

              try {
                // Parse natural language time if needed
                let scheduledTime = args.scheduledAt;
                if (!/^\d{4}-\d{2}-\d{2}/.test(scheduledTime)) {
                  // Simple natural language parsing
                  const now = new Date();
                  if (/tomorrow/i.test(scheduledTime)) {
                    now.setDate(now.getDate() + 1);
                  }
                  const timeMatch = scheduledTime.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
                  if (timeMatch) {
                    let hours = parseInt(timeMatch[1]);
                    const minutes = parseInt(timeMatch[2] || '0');
                    const ampm = timeMatch[3]?.toLowerCase();
                    if (ampm === 'pm' && hours < 12) hours += 12;
                    if (ampm === 'am' && hours === 12) hours = 0;
                    now.setHours(hours, minutes, 0, 0);
                  }
                  scheduledTime = now.toISOString();
                }

                // Note: Scheduled posts are stored per-project
                // For cross-project scheduling, inform user to use a specific project
                const formattedTime = new Date(scheduledTime).toLocaleString();
                setMessages(prev => prev.map(m => m.id === streamingMessageId ? {
                  ...m,
                  text: m.text.replace(`📅 Scheduling post for ${args.scheduledAt}...`, `⚠️ Post scheduling requires a project context. Please open a specific project and use the assistant there to schedule posts for ${formattedTime} to ${platforms.join(', ')}.`)
                } : m));
              } catch (err: any) {
                setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text.replace(`📅 Scheduling post for ${args.scheduledAt}...`, `❌ Error scheduling: ${err.message}`) } : m));
              }
            }
          } catch (err: any) {
            console.error(`Error executing tool ${fc.name}:`, err);
            setMessages(prev => prev.map(m => m.id === streamingMessageId ? { ...m, text: m.text + `\n\n❌ Error generating content: ${err.message}` } : m));
          }
        }
      }

      setMessages(prev =>
        prev.map(msg =>
          msg.id === streamingMessageId ? { ...msg, isGenerating: false } : msg
        )
      );

      if (!fullText.trim() && aggregatedFunctionCalls.length === 0) {
        const fallbackText = 'I was unable to generate a response. Please try asking in a different way.';
        setMessages(prev =>
          prev.map(msg =>
            msg.id === streamingMessageId ? { ...msg, text: fallbackText } : msg
          )
        );
      }
    } catch (e) {
      console.error('Home chat error:', e);
      setError('Failed to get response. Please try again.');
      setIsProcessing(false);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleModeChange = (newMode: AssistantMode) => {
    if (newMode === mode) return;
    if (mode === 'voice' && connectionStatus === 'connected') {
      disconnectVoice();
    }
    setMode(newMode);
    setError(null);
  };

  const handleClearChat = useCallback(() => {
    if (messages.length === 0) return;
    if (!confirm('Clear all conversation history? This cannot be undone.')) return;
    setMessages([]);
    setTranscriptBuffer('');
    setUserTranscriptBuffer('');
  }, [messages.length]);

  useEffect(() => {
    return () => {
      disconnectVoice();
    };
  }, []);

  const totalProjects = projects.length;
  const totalResearch = projects.reduce((acc, p) => acc + (p.researchSessions?.length || 0), 0);
  const totalNotes = projects.reduce((acc, p) => acc + (p.notes?.length || 0), 0);
  const totalTasks = projects.reduce((acc, p) => acc + (p.tasks?.length || 0), 0);

  return (
    <div className="fixed inset-0 sm:inset-auto sm:bottom-6 sm:right-6 z-[10000] pointer-events-none flex sm:block items-end justify-center sm:justify-end">
      <div
        className={`pointer-events-auto w-full h-full sm:w-[360px] sm:h-[560px] rounded-none sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden border backdrop-blur-2xl transition-transform duration-200
          ${isDarkMode ? 'bg-[#050509]/80 border-white/10' : 'bg-white/80 border-black/10'}`}
      >
        <header className={`flex items-center justify-between px-4 sm:px-5 py-3 sm:py-3.5 border-b ${isDarkMode ? 'border-white/10 bg-black/5' : 'border-gray-200 bg-gray-50/50'}`}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl flex items-center justify-center bg-[#0a84ff]/15 flex-shrink-0">
              <svg className="w-4 h-4 sm:w-5 sm:h-5 text-[#0a84ff]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h8m-8 6h16" />
              </svg>
            </div>
            <div className="min-w-0">
              <h2 className={`font-semibold text-sm sm:text-base truncate ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                Home AI Assistant
              </h2>
              <p className={`text-[10px] sm:text-xs truncate ${isDarkMode ? 'text-[#86868b]' : 'text-gray-500'}`}>
                {totalProjects} projects, {totalResearch} research, {totalNotes} notes, {totalTasks} tasks
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {mode === 'voice' && connectionStatus === 'connected' ? (
              <button
                onClick={disconnectVoice}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium bg-[#ff453a] hover:bg-[#ff5a4f] text-white transition-all active:scale-95"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                </svg>
                End
              </button>
            ) : (
              <div className={`flex items-center gap-0.5 p-1 rounded-full ${isDarkMode ? 'bg-[#2d2d2f]' : 'bg-gray-200'}`}>
                <button
                  onClick={() => handleModeChange('chat')}
                  className={`px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-all ${mode === 'chat'
                    ? 'bg-[#0a84ff] text-white'
                    : isDarkMode
                      ? 'text-[#86868b] hover:text-white'
                      : 'text-gray-600 hover:text-gray-900'
                    }`}
                >
                  Chat
                </button>
                <button
                  onClick={() => handleModeChange('voice')}
                  className={`px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-all ${mode === 'voice'
                    ? 'bg-[#0a84ff] text-white'
                    : isDarkMode
                      ? 'text-[#86868b] hover:text-white'
                      : 'text-gray-600 hover:text-gray-900'
                    }`}
                >
                  Voice
                </button>
              </div>
            )}

            {messages.length > 0 && (
              <button
                onClick={handleClearChat}
                className={`p-2 rounded-full transition-colors ${isDarkMode ? 'hover:bg-[#2d2d2f] text-[#86868b] hover:text-white' : 'hover:bg-gray-200 text-gray-500 hover:text-gray-900'}`}
                title="Clear conversation"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}

            <button
              onClick={onClose}
              className={`p-2 rounded-full transition-colors ${isDarkMode ? 'hover:bg-[#2d2d2f] text-[#86868b] hover:text-white' : 'hover:bg-gray-200 text-gray-500 hover:text-gray-900'}`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </header>

        {mode === 'chat' ? (
          <>
            <div className={`flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-5 space-y-4 ${isDarkMode ? 'bg-[#000000]' : 'bg-gray-50'}`}>
              {messages.length === 0 && (
                <div className="text-center py-6 sm:py-8">
                  <div className={`${isDarkMode ? 'bg-[#2d2d2f]' : 'bg-gray-200'} w-14 h-14 sm:w-16 sm:h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center`}>
                    <svg className={`${isDarkMode ? 'text-[#424245]' : 'text-gray-400'} w-7 h-7 sm:w-8 sm:h-8`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                  </div>
                  <h3 className={`${isDarkMode ? 'text-white' : 'text-gray-900'} text-base sm:text-lg font-semibold mb-2`}>
                    Ask across all projects
                  </h3>
                  <p className={`${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'} text-xs sm:text-sm max-w-md mx-auto px-4`}>
                    I can see all of your projects, research sessions, notes, tasks, and assets. Ask questions that span multiple projects or compare them.
                  </p>
                </div>
              )}

              {messages.map(message => {
                if (message.role === 'model' && !(message.text || '').trim() && !message.imageUrl && !message.audioUrl && !message.computerUseGoal) {
                  return null;
                }

                // Render inline Computer Use viewer for browser automation messages
                if (message.computerUseGoal) {
                  return (
                    <div key={message.id} className="w-full">
                      <ComputerUseViewer
                        goal={message.computerUseGoal}
                        isDarkMode={isDarkMode}
                        onComplete={(result) => {
                          setMessages(prev =>
                            prev.map(m =>
                              m.id === message.id
                                ? { ...m, text: `✅ Browser automation completed:\n\n${result}`, computerUseGoal: undefined }
                                : m
                            )
                          );
                          setActiveComputerUseMessageId(null);
                        }}
                        onCancel={() => {
                          setMessages(prev =>
                            prev.map(m =>
                              m.id === message.id
                                ? { ...m, text: '❌ Browser automation was cancelled.', computerUseGoal: undefined }
                                : m
                            )
                          );
                          setActiveComputerUseMessageId(null);
                        }}
                        onError={(err) => {
                          setMessages(prev =>
                            prev.map(m =>
                              m.id === message.id
                                ? { ...m, text: `⚠️ Browser automation failed: ${err}`, computerUseGoal: undefined }
                                : m
                            )
                          );
                          setActiveComputerUseMessageId(null);
                        }}
                      />
                    </div>
                  );
                }

                return (
                  <div
                    key={message.id}
                    className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] sm:max-w-[80%] rounded-2xl px-4 py-3 ${message.role === 'user'
                        ? 'bg-[#0a84ff] text-white'
                        : isDarkMode
                          ? 'bg-[#2d2d2f] text-[#e5e5ea]'
                          : 'bg-gray-200 text-gray-900'
                        }`}
                    >
                      <div className="text-sm overflow-x-auto" style={{ wordWrap: 'break-word', overflowWrap: 'break-word' }}>
                        <ReactMarkdown className={`${isDarkMode ? 'prose prose-invert' : 'prose'} max-w-none prose-pre:overflow-x-auto prose-code:break-all`}>
                          {message.text}
                        </ReactMarkdown>

                        {message.imageUrl && (
                          <div className="mt-3 rounded-xl overflow-hidden border border-black/10 dark:border-white/10 shadow-sm">
                            <img src={message.imageUrl} alt="Generated asset" className="w-full h-auto max-h-[400px] object-cover" />
                          </div>
                        )}

                        {message.videoUrl && (
                          <div className="mt-3 rounded-xl overflow-hidden border border-black/10 dark:border-white/10 bg-black shadow-sm">
                            <video src={message.videoUrl} controls className="w-full h-auto max-h-[400px]" />
                          </div>
                        )}

                        {message.audioUrl && (
                          <div className="mt-3">
                            <audio src={message.audioUrl} controls className="w-full" />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {isProcessing && !messages.some(m => m.role === 'model' && m.isGenerating && (m.text || '').trim()) && (
                <div className="flex justify-start">
                  <div className={`${isDarkMode ? 'bg-[#2d2d2f]' : 'bg-gray-200'} rounded-2xl px-4 py-3`}>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 bg-[#0a84ff] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-2 h-2 bg-[#0a84ff] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-2 h-2 bg-[#0a84ff] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {error && (
              <div className="px-4 sm:px-5 py-2 bg-[#ff453a]/10 border-t border-[#ff453a]/20">
                <p className="text-xs sm:text-sm text-[#ff453a]">{error}</p>
              </div>
            )}
          </>
        ) : (
          <>
            {connectionStatus === 'connected' ? (
              <div className={`flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 ${isDarkMode ? 'bg-[#000000]' : 'bg-gray-50'}`}>
                {messages.length === 0 && (
                  <div className="text-center py-6 sm:py-8">
                    <div className="w-14 h-14 sm:w-16 sm:h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center bg-[#0a84ff]/20">
                      <svg className="w-7 h-7 sm:w-8 sm:h-8 text-[#0a84ff]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                      </svg>
                    </div>
                    <h3 className={`${isDarkMode ? 'text-white' : 'text-gray-900'} text-base sm:text-lg font-semibold mb-2`}>
                      {isSpeaking ? 'Speaking...' : 'Listening...'}
                    </h3>
                    <p className={`${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'} text-xs sm:text-sm max-w-md mx-auto px-4`}>
                      Start talking to ask questions across all of your projects.
                    </p>
                  </div>
                )}

                {messages.map(message => {
                  if (message.role === 'model' && message.isGenerating && !(message.text || '').trim()) {
                    return null;
                  }

                  return (
                    <div
                      key={message.id}
                      className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[85%] sm:max-w-[80%] rounded-2xl px-4 py-3 ${message.role === 'user'
                          ? 'bg-[#0a84ff] text-white'
                          : isDarkMode
                            ? 'bg-[#2d2d2f] text-[#e5e5ea]'
                            : 'bg-gray-200 text-gray-900'
                          }`}
                      >
                        <div className="text-sm">
                          <ReactMarkdown className={isDarkMode ? 'prose prose-invert max-w-none' : 'prose max-w-none'}>
                            {message.text}
                          </ReactMarkdown>

                          {message.imageUrl && (
                            <div className="mt-3 rounded-xl overflow-hidden border border-black/10 dark:border-white/10 shadow-sm">
                              <img src={message.imageUrl} alt="Generated asset" className="w-full h-auto max-h-[400px] object-cover" />
                            </div>
                          )}

                          {message.videoUrl && (
                            <div className="mt-3 rounded-xl overflow-hidden border border-black/10 dark:border-white/10 bg-black shadow-sm">
                              <video src={message.videoUrl} controls className="w-full h-auto max-h-[400px]" />
                            </div>
                          )}

                          {message.audioUrl && (
                            <div className="mt-3">
                              <audio src={message.audioUrl} controls className="w-full" />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {isSpeaking && (
                  <div className="flex justify-start">
                    <div className={`${isDarkMode ? 'bg-[#2d2d2f]' : 'bg-gray-200'} rounded-2xl px-4 py-3`}>
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 bg-[#0a84ff] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <div className="w-2 h-2 bg-[#0a84ff] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <div className="w-2 h-2 bg-[#0a84ff] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            ) : (
              <div className={`flex-1 overflow-y-auto flex items-center justify-center ${isDarkMode ? 'bg-[#000000]' : 'bg-gray-50'}`}>
                <div className="p-6 sm:p-8">
                  <div className="p-0 sm:p-0 flex flex-col items-center text-center space-y-5 sm:space-y-6">
                    <div className="relative flex items-center justify-center mx-auto">
                      <div
                        className={`w-28 h-28 sm:w-32 sm:h-32 rounded-full flex items-center justify-center transition-all duration-300 ${connectionStatus === 'connecting'
                          ? 'bg-[#ff9f0a]/50 animate-pulse'
                          : isDarkMode
                            ? 'bg-[#2d2d2f]'
                            : 'bg-gray-200'
                          }`}
                      >
                        <span className="text-4xl sm:text-5xl">
                          {connectionStatus === 'connecting' ? '🔄' : '🎙️'}
                        </span>
                      </div>
                    </div>

                    <div>
                      <h3 className={`${isDarkMode ? 'text-white' : 'text-gray-900'} text-lg sm:text-xl font-semibold mb-2`}>
                        {connectionStatus === 'connecting' ? 'Connecting...' : 'Voice Mode'}
                      </h3>
                      <p className={`${isDarkMode ? 'text-[#86868b]' : 'text-gray-600'} text-xs sm:text-sm max-w-sm mx-auto px-4`}>
                        Start a real-time conversation about anything across your projects.
                      </p>
                    </div>

                    {error && (
                      <p className="text-xs sm:text-sm text-[#ff453a] bg-[#ff453a]/10 px-4 py-2 rounded-xl">{error}</p>
                    )}

                    <button
                      onClick={connectVoice}
                      disabled={connectionStatus === 'connecting'}
                      className="flex items-center gap-2 bg-[#0a84ff] hover:bg-[#0b8cff] text-white font-medium py-3 px-5 sm:px-6 rounded-full transition-all active:scale-95 disabled:opacity-50 text-sm sm:text-base"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                      </svg>
                      {connectionStatus === 'connecting' ? 'Connecting...' : 'Start'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        <div className={`p-3 sm:p-4 border-t safe-area-pb ${isDarkMode ? 'border-[#3d3d3f]/50 bg-[#1d1d1f]' : 'border-gray-200 bg-white'}`}>
          {pendingAttachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {pendingAttachments.map(att => (
                <div
                  key={att.id}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] border ${isDarkMode ? 'border-[#3d3d3f]/60 bg-black/20 text-white' : 'border-gray-200 bg-gray-50 text-gray-900'}`}
                  title={att.status === 'error' ? (att.error || 'Upload failed') : (att.uploaded?.uri || att.file.name)}
                >
                  {att.previewUrl && (
                    <img
                      src={att.previewUrl}
                      alt={att.uploaded?.displayName || att.file.name}
                      className="w-6 h-6 rounded object-cover flex-shrink-0"
                    />
                  )}
                  <span className="max-w-[160px] truncate">{att.uploaded?.displayName || att.file.name}</span>
                  <span
                    className={`${att.status === 'ready' ? 'text-green-500' : att.status === 'error' ? 'text-red-500' : (isDarkMode ? 'text-[#86868b]' : 'text-gray-500')}`}
                  >
                    {att.status === 'uploading' ? 'Uploading…' : att.status === 'ready' ? 'Ready' : 'Error'}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(att.id)}
                    className={`px-1.5 py-0.5 rounded-full ${isDarkMode ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}
                    aria-label="Remove attachment"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2 sm:gap-3">
            <input
              ref={attachmentsInputRef}
              type="file"
              multiple
              accept="image/*,application/pdf,.txt,.csv,.json"
              className="hidden"
              onChange={(e) => {
                void handlePickAttachments(e.target.files);
                if (attachmentsInputRef.current) attachmentsInputRef.current.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => attachmentsInputRef.current?.click()}
              disabled={isProcessing || isUploadingAttachments}
              className={`p-3 rounded-xl sm:rounded-2xl transition-all active:scale-95 flex-shrink-0 border ${isDarkMode ? 'bg-[#2d2d2f] text-white border-[#3d3d3f]/50 hover:bg-[#3d3d3f]' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'} disabled:opacity-50 disabled:cursor-not-allowed`}
              title="Attach files"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21.44 11.05l-8.49 8.49a5 5 0 01-7.07-7.07l8.49-8.49a3.5 3.5 0 114.95 4.95l-8.84 8.84a2 2 0 11-2.83-2.83l8.49-8.49" />
              </svg>
            </button>
            <textarea
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder={mode === 'voice' ? 'Type a message to the live assistant…' : 'Ask about your projects...'}
              rows={1}
              className={`flex-1 resize-none rounded-xl sm:rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#0a84ff] border ${isDarkMode
                ? 'bg-[#2d2d2f] text-white placeholder-[#636366] border-[#3d3d3f]/50'
                : 'bg-gray-100 text-gray-900 placeholder-gray-500 border-gray-300'
                }`}
              style={{ minHeight: '44px', maxHeight: '120px' }}
            />
            <button
              onClick={handleSendMessage}
              disabled={(!inputText.trim() && readyAttachments.length === 0) || isProcessing || isUploadingAttachments}
              className="p-3 bg-[#0a84ff] hover:bg-[#0b8cff] text-white rounded-xl sm:rounded-2xl transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 flex-shrink-0"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes slide-up-home-assistant {
          from {
            transform: translateY(100%);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
        .safe-area-pb {
          padding-bottom: max(1rem, env(safe-area-inset-bottom));
        }
      `}</style>
    </div>
  );
};
