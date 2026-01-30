import React, { useState, useMemo } from 'react';
import { worldLabsService, OperationResponse } from '../services/worldLabsService';
import { AssetItem } from '../types';

interface WorldGeneratorProps {
    onWorldGenerated: (world: OperationResponse) => void;
    onError: (error: string) => void;
    assets: AssetItem[];
}

// Icons
const IconCube = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
);
const IconMagic = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
    </svg>
);
const IconImage = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
);
const IconImages = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
    </svg>
);
const IconVideo = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
);
const IconCloudUpload = () => (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
    </svg>
);

const Spinner = () => (
    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-current" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
);

export const WorldGenerator: React.FC<WorldGeneratorProps> = ({ onWorldGenerated, onError, assets }) => {
    const [activeTab, setActiveTab] = useState<'text' | 'image' | 'video' | 'multi-image'>('text');
    const [inputMode, setInputMode] = useState<'upload' | 'asset'>('upload');
    const [textPrompt, setTextPrompt] = useState('');
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [selectedAsset, setSelectedAsset] = useState<AssetItem | null>(null);
    const [selectedAssets, setSelectedAssets] = useState<AssetItem[]>([]);
    const [isGenerating, setIsGenerating] = useState(false);
    const [generatedWorld, setGeneratedWorld] = useState<OperationResponse['response'] | null>(null);
    const [progress, setProgress] = useState<string>('');
    const [error, setError] = useState<string | null>(null);

    // Filter compatible assets based on active tab
    const compatibleAssets = useMemo(() => {
        if (!assets) return [];
        if (activeTab === 'image' || activeTab === 'multi-image') {
            return assets.filter(a => {
                const type = a.type;
                if (type === 'video' || type === 'podcast' || type === 'book' || type === 'table' || type === 'leadform' || type === 'doc' || type === 'website' || type === 'blog') return false;
                return true;
            });
        } else if (activeTab === 'video') {
            return assets.filter(a => a.type === 'video');
        }
        return [];
    }, [assets, activeTab]);

    const handleAssetToggle = (asset: AssetItem) => {
        if (activeTab === 'multi-image') {
            setSelectedAssets(prev => {
                const exists = prev.find(a => a.id === asset.id);
                if (exists) {
                    return prev.filter(a => a.id !== asset.id);
                } else {
                    if (prev.length >= 8) return prev; // Max 8 images
                    return [...prev, asset];
                }
            });
        } else {
            setSelectedAsset(asset);
        }
    };

    const handleGenerate = async () => {
        setIsGenerating(true);
        setError(null);
        setProgress('Initializing job...');
        // setGeneratedWorld(null); // Removed as per instruction

        try {
            if (!textPrompt) throw new Error('Please describe the world');

            let request: any = {
                world_prompt: {
                    type: activeTab,
                    text_prompt: textPrompt
                }
            };

            // Input Handling
            const handleMediaInput = async () => {
                const isMulti = activeTab === 'multi-image';
                const isVideo = activeTab === 'video';

                if (isMulti) {
                    if (selectedAssets.length < 2) throw new Error('Please select at least 2 images (Max 8)');
                    request.world_prompt.multi_image_prompt = selectedAssets.map((asset, index) => ({
                        content: { source: 'uri', uri: asset.url },
                        azimuth: (360 / selectedAssets.length) * index
                    }));
                    return;
                }

                if (inputMode === 'upload') {
                    if (!selectedFile) throw new Error(`Please select a ${isVideo ? 'video' : 'image'}`);
                    setProgress(`Uploading ${isVideo ? 'video' : 'image'}...`);
                    const mediaId = await worldLabsService.uploadMedia(selectedFile);
                    request.world_prompt[isVideo ? 'video_prompt' : 'image_prompt'] = { source: 'media_asset', media_asset_id: mediaId };
                } else {
                    if (!selectedAsset) throw new Error(`Please select a ${isVideo ? 'video' : 'image'} asset`);
                    request.world_prompt[isVideo ? 'video_prompt' : 'image_prompt'] = { source: 'uri', uri: selectedAsset.url };
                }
            };

            if (activeTab !== 'text') {
                await handleMediaInput();
            }

            if (activeTab === 'video') request.world_prompt.type = 'video';

            setProgress('Starting generation...');
            // Start the job, don't wait for completion here
            const operation = await worldLabsService.generateWorld(request);

            // Notify parent immediately with "generating" status
            onWorldGenerated(operation);

            // Allow user to start another or see status in queue
            setTextPrompt('');
            setSelectedFile(null);

        } catch (err: any) {
            console.error(err);
            setError(err.message || 'Failed to start generation');
            onError(err.message);
        } finally {
            setIsGenerating(false);
            setProgress('');
        }
    };

    const tabs = [
        { id: 'text', label: 'Text', icon: IconMagic },
        { id: 'image', label: 'Image', icon: IconImage },
        { id: 'multi-image', label: 'Multi View', icon: IconImages },
        { id: 'video', label: 'Video', icon: IconVideo }
    ];

    return (
        <div className="w-full max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-400 tracking-tight">
                        World Generator
                    </h2>
                    <p className="mt-2 text-gray-500 dark:text-gray-400 text-sm max-w-lg leading-relaxed">
                        Transform your ideas into navigable 3D worlds using generative AI.
                        Start with text, or guide the structure with images and video.
                    </p>
                </div>

                {/* Modern Segmented Control */}
                <div className="flex p-1.5 bg-gray-100/80 dark:bg-gray-800/80 backdrop-blur-md rounded-2xl border border-gray-200/50 dark:border-gray-700/50 self-start md:self-center">
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => {
                                setActiveTab(tab.id as any);
                                if (tab.id !== 'text') setInputMode(tab.id === 'multi-image' ? 'asset' : 'upload');
                            }}
                            className={`
                                relative px-4 py-2 text-sm font-semibold rounded-xl transition-all duration-300 ease-out flex items-center gap-2
                                ${activeTab === tab.id
                                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm ring-1 ring-black/5 dark:ring-white/10'
                                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200/50 dark:hover:bg-gray-700/50'
                                }
                            `}
                        >
                            <tab.icon />
                            <span>{tab.label}</span>
                        </button>
                    ))}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Left Column: Controls (Prompt & Inputs) */}
                <div className="lg:col-span-5 space-y-6">
                    {/* Prompt Input */}
                    <div className="group relative">
                        <div className="absolute -inset-0.5 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-2xl opacity-20 group-focus-within:opacity-100 transition duration-500 blur-sm"></div>
                        <div className="relative bg-white dark:bg-gray-900 rounded-xl p-1">
                            <textarea
                                value={textPrompt}
                                onChange={(e) => setTextPrompt(e.target.value)}
                                placeholder="Describe your world in detail..."
                                className="w-full bg-transparent p-4 text-gray-900 dark:text-white placeholder-gray-400 text-base border-none focus:ring-0 resize-none min-h-[140px] leading-relaxed"
                            />
                            <div className="px-4 pb-2 flex justify-between items-center border-t border-gray-100 dark:border-gray-800 pt-2">
                                <span className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">Prompt</span>
                                <span className="text-xs text-gray-400">{textPrompt.length} chars</span>
                            </div>
                        </div>
                    </div>

                    {/* Generate Button */}
                    <button
                        onClick={handleGenerate}
                        disabled={isGenerating}
                        className={`
                            relative w-full py-4 rounded-xl font-bold text-white flex items-center justify-center gap-3 overflow-hidden transition-all duration-300
                            ${isGenerating
                                ? 'bg-gray-900/5 dark:bg-white/5 cursor-wait'
                                : 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:scale-[1.02] hover:shadow-xl'
                            }
                        `}
                    >
                        {isGenerating ? (
                            <>
                                <Spinner />
                                <span className="text-gray-500 dark:text-gray-400 font-medium">{progress}</span>
                            </>
                        ) : (
                            <>
                                <span className="relative z-10 flex items-center gap-2">
                                    <IconCube /> Generate World
                                </span>
                                {/* Subtle gradient overlay on hover */}
                                <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/0 via-indigo-500/10 to-purple-500/0 opacity-0 hover:opacity-100 transition-opacity duration-500" />
                            </>
                        )}
                    </button>

                    {error && (
                        <div className="p-4 bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 rounded-r-lg">
                            <p className="text-sm text-red-700 dark:text-red-300 font-medium">{error}</p>
                        </div>
                    )}
                </div>

                {/* Right Column: Reference Assets or Tips */}
                <div className="lg:col-span-7">
                    {(activeTab !== 'text') ? (
                        <div className="bg-gray-50 dark:bg-gray-800/30 rounded-2xl border border-gray-200/50 dark:border-gray-700/50 p-2 min-h-[300px] flex flex-col">
                            {/* Sub-Header / Toggle */}
                            {activeTab !== 'multi-image' && (
                                <div className="flex items-center justify-between px-4 py-3 mb-2">
                                    <span className="text-sm font-semibold text-gray-600 dark:text-gray-300">Reference {activeTab === 'video' ? 'Video' : 'Image'}</span>
                                    <div className="flex bg-gray-200/50 dark:bg-gray-700/50 p-1 rounded-lg">
                                        <button onClick={() => setInputMode('upload')} className={`px-3 py-1 text-xs rounded-md transition-all ${inputMode === 'upload' ? 'bg-white dark:bg-gray-600 shadow-sm text-black dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}>Upload</button>
                                        <button onClick={() => setInputMode('asset')} className={`px-3 py-1 text-xs rounded-md transition-all ${inputMode === 'asset' ? 'bg-white dark:bg-gray-600 shadow-sm text-black dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}>Assets</button>
                                    </div>
                                </div>
                            )}

                            <div className="flex-1 rounded-xl bg-white dark:bg-gray-900/50 border border-gray-100 dark:border-gray-700/30 relative overflow-hidden">
                                {inputMode === 'upload' && activeTab !== 'multi-image' ? (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center cursor-pointer group hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                                        <input
                                            type="file"
                                            accept={activeTab === 'video' ? "video/*" : "image/*"}
                                            onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                                            className="absolute inset-0 opacity-0 cursor-pointer z-10"
                                        />
                                        <div className="p-4 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-500 rounded-full mb-3 group-hover:scale-110 transition-transform">
                                            <IconCloudUpload />
                                        </div>
                                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{selectedFile ? selectedFile.name : `Drop ${activeTab} here`}</p>
                                        <p className="text-xs text-gray-400 mt-1">or click to browse</p>
                                    </div>
                                ) : (
                                    <div className="absolute inset-0 overflow-y-auto p-4 custom-scrollbar">
                                        {compatibleAssets.length === 0 ? (
                                            <div className="h-full flex flex-col items-center justify-center text-gray-400">
                                                <p className="text-sm">No compatible assets found.</p>
                                            </div>
                                        ) : (
                                            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                                                {compatibleAssets.map(asset => {
                                                    const isSelected = activeTab === 'multi-image'
                                                        ? selectedAssets.some(a => a.id === asset.id)
                                                        : selectedAsset?.id === asset.id;

                                                    const selectIndex = activeTab === 'multi-image'
                                                        ? selectedAssets.findIndex(a => a.id === asset.id) + 1
                                                        : null;

                                                    return (
                                                        <button
                                                            key={asset.id}
                                                            onClick={() => handleAssetToggle(asset)}
                                                            className={`relative aspect-square group rounded-lg overflow-hidden transition-all duration-300 ${isSelected ? 'ring-2 ring-indigo-500 ring-offset-2 dark:ring-offset-gray-900' : 'hover:opacity-90'}`}
                                                        >
                                                            {(activeTab === 'video' || asset.type === 'video') ? (
                                                                <video src={asset.url || ''} className="w-full h-full object-cover pointer-events-none" />
                                                            ) : (
                                                                <img src={asset.url || ''} alt="" className="w-full h-full object-cover" />
                                                            )}

                                                            <div className={`absolute inset-0 bg-black/40 transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} />

                                                            {isSelected && (
                                                                <div className="absolute inset-0 flex items-center justify-center">
                                                                    <div className="bg-indigo-500 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shadow-lg scale-110">
                                                                        {activeTab === 'multi-image' ? selectIndex : '✓'}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        // Placeholder / Creative Tips when in Text Mode
                        <div className="h-full bg-gradient-to-br from-indigo-500/5 to-purple-500/5 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 flex items-center justify-center p-8">
                            <div className="text-center max-w-sm">
                                <div className="inline-flex p-3 rounded-xl bg-white dark:bg-gray-800 shadow-sm mb-4">
                                    <span className="text-2xl">💡</span>
                                </div>
                                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Pro Tip</h3>
                                <p className="text-gray-500 dark:text-gray-400 text-sm">
                                    For best results, describe lighting and perspective.
                                    <br />E.g., "A cyberpunk street <i>at sunset</i> with <i>neon rim lighting</i>, viewed from <i>low angle</i>."
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Generated Result - Full Width Card */}
            {generatedWorld && (
                <div className="mt-8 animate-in slide-in-from-bottom-4 duration-700">
                    <div className="relative rounded-2xl overflow-hidden bg-black aspect-video md:aspect-[21/9] group shadow-2xl shadow-indigo-500/20">
                        <img
                            src={generatedWorld?.assets?.thumbnail_url}
                            alt="Generated World"
                            className="w-full h-full object-cover transition-transform duration-[1.5s] ease-in-out group-hover:scale-110"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent flex flex-col justify-end p-8">
                            <div className="transform translate-y-4 group-hover:translate-y-0 transition-transform duration-500">
                                <h3 className="text-2xl font-bold text-white mb-2">{generatedWorld?.display_name || 'Untitled World'}</h3>
                                <div className="flex items-center gap-4">
                                    <a
                                        href={generatedWorld?.world_marble_url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center gap-2 px-6 py-3 bg-white text-black rounded-full font-bold text-sm tracking-wide hover:bg-gray-200 transition-colors"
                                    >
                                        <IconCube /> ENTER WORLD
                                    </a>
                                    <span className="text-white/60 text-sm">Generated just now</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
