import React, { useState } from 'react';
import { worldLabsService, OperationResponse } from '../services/worldLabsService';
import { AssetItem } from '../types';

// Icons
const IconCube = () => (
    <svg className="w-6 h-6 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
);

const IconImage = () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
);

const IconVideo = () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
);

const IconMagic = () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
    </svg>
);

const IconUpload = () => (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
    </svg>
);

const IconFolder = () => (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
);

const Spinner = () => (
    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <circle cx="12" cy="12" r="10" strokeWidth="4" className="opacity-25" />
        <path d="M4 12a8 8 0 018-8" strokeWidth="4" className="opacity-75" />
    </svg>
);

interface WorldGeneratorProps {
    onWorldGenerated?: (world: any) => void;
    availableAssets?: AssetItem[];
}

export const WorldGenerator: React.FC<WorldGeneratorProps> = ({ onWorldGenerated, availableAssets = [] }) => {
    const [activeTab, setActiveTab] = useState<'text' | 'image' | 'video'>('text');
    const [textPrompt, setTextPrompt] = useState('');
    const [
        inputMode, setInputMode
    ] = useState<'upload' | 'asset'>('upload');

    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [selectedAsset, setSelectedAsset] = useState<AssetItem | null>(null);

    const [isGenerating, setIsGenerating] = useState(false);
    const [progress, setProgress] = useState<string>('');
    const [generatedWorld, setGeneratedWorld] = useState<any | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Filter compatible assets based on active tab
    const compatibleAssets = availableAssets.filter(asset => {
        if (activeTab === 'image') {
            return ['header', 'slide', 'notemap', 'social'].includes(asset.type) || asset.type.startsWith('image/');
        }
        if (activeTab === 'video') {
            return asset.type === 'video' || asset.type.startsWith('video/');
        }
        return false;
    });

    const handleGenerate = async () => {
        setIsGenerating(true);
        setError(null);
        setProgress('Starting generation...');
        setGeneratedWorld(null);

        try {
            let request: any = {
                model: 'Marble 0.1-plus',
                display_name: textPrompt.slice(0, 50) || 'New World',
                world_prompt: {
                    text_prompt: textPrompt || undefined
                }
            };

            if (activeTab === 'text') {
                request.world_prompt.type = 'text';
                if (!textPrompt) throw new Error('Please enter a text prompt');
            } else if (activeTab === 'image') {
                request.world_prompt.type = 'image';

                if (inputMode === 'upload') {
                    if (!selectedFile) throw new Error('Please select an image');
                    setProgress('Uploading image...');
                    const mediaId = await worldLabsService.uploadMedia(selectedFile);
                    request.world_prompt.image_prompt = { source: 'media_asset', media_asset_id: mediaId };
                } else {
                    if (!selectedAsset?.url) throw new Error('Please select an asset');
                    request.world_prompt.image_prompt = { source: 'uri', uri: selectedAsset.url };
                }

            } else if (activeTab === 'video') {
                request.world_prompt.type = 'video';

                if (inputMode === 'upload') {
                    if (!selectedFile) throw new Error('Please select a video');
                    setProgress('Uploading video...');
                    const mediaId = await worldLabsService.uploadMedia(selectedFile);
                    request.world_prompt.video_prompt = { source: 'media_asset', media_asset_id: mediaId };
                } else {
                    if (!selectedAsset?.url) throw new Error('Please select an asset');
                    request.world_prompt.video_prompt = { source: 'uri', uri: selectedAsset.url };
                }
            }

            setProgress('Initiating generation...');
            const op = await worldLabsService.generateWorld(request);

            setProgress('Generating world (this may take a few minutes)...');
            const result = await worldLabsService.pollUntilComplete(op.operation_id, (status) => {
                if (status.metadata?.progress) {
                    setProgress(`${status.metadata.progress.status}: ${status.metadata.progress.description}`);
                }
            });

            setGeneratedWorld(result);
            if (onWorldGenerated) onWorldGenerated(result);

        } catch (err: any) {
            console.error(err);
            setError(err.message || 'Generation failed');
        } finally {
            setIsGenerating(false);
            setProgress('');
        }
    };

    return (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 max-w-2xl mx-auto">
            <div className="flex items-center gap-2 mb-6">
                <IconCube />
                <h2 className="text-xl font-bold dark:text-white">Generate 3D World</h2>
            </div>

            <div className="flex gap-4 mb-6 border-b dark:border-gray-700">
                <button
                    onClick={() => setActiveTab('text')}
                    className={`pb-2 px-4 flex items-center gap-2 ${activeTab === 'text' ? 'border-b-2 border-indigo-500 text-indigo-500' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}
                >
                    <IconMagic /> Text to World
                </button>
                <button
                    onClick={() => { setActiveTab('image'); setInputMode('upload'); }}
                    className={`pb-2 px-4 flex items-center gap-2 ${activeTab === 'image' ? 'border-b-2 border-indigo-500 text-indigo-500' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}
                >
                    <IconImage /> Image to World
                </button>
                <button
                    onClick={() => { setActiveTab('video'); setInputMode('upload'); }}
                    className={`pb-2 px-4 flex items-center gap-2 ${activeTab === 'video' ? 'border-b-2 border-indigo-500 text-indigo-500' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}
                >
                    <IconVideo /> Video to World
                </button>
            </div>

            <div className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Description
                    </label>
                    <textarea
                        value={textPrompt}
                        onChange={(e) => setTextPrompt(e.target.value)}
                        placeholder="Describe the world you want to create..."
                        className="w-full p-3 rounded border dark:bg-gray-700 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-indigo-500"
                        rows={3}
                    />
                </div>

                {(activeTab === 'image' || activeTab === 'video') && (
                    <div>
                        <div className="flex items-center gap-4 mb-3">
                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                {activeTab === 'image' ? 'Image Source' : 'Video Source'}
                            </label>
                            <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
                                <button
                                    onClick={() => setInputMode('upload')}
                                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${inputMode === 'upload'
                                        ? 'bg-white dark:bg-gray-600 shadow text-gray-900 dark:text-white'
                                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                                        }`}
                                >
                                    <div className="flex items-center gap-1">
                                        <IconUpload /> Upload
                                    </div>
                                </button>
                                <button
                                    onClick={() => setInputMode('asset')}
                                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${inputMode === 'asset'
                                        ? 'bg-white dark:bg-gray-600 shadow text-gray-900 dark:text-white'
                                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                                        }`}
                                >
                                    <div className="flex items-center gap-1">
                                        <IconFolder /> From Assets
                                    </div>
                                </button>
                            </div>
                        </div>

                        {inputMode === 'upload' ? (
                            <input
                                type="file"
                                accept={activeTab === 'image' ? "image/*" : "video/*"}
                                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                                className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                            />
                        ) : (
                            <div className="space-y-2">
                                {compatibleAssets.length === 0 ? (
                                    <div className="p-4 border border-dashed rounded text-center text-sm text-gray-500 dark:text-gray-400">
                                        No compatible {activeTab}s found in assets.
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-60 overflow-y-auto p-1">
                                        {compatibleAssets.map(asset => (
                                            <button
                                                key={asset.id}
                                                onClick={() => setSelectedAsset(asset)}
                                                className={`relative aspect-square rounded overflow-hidden border-2 transition-all ${selectedAsset?.id === asset.id
                                                    ? 'border-indigo-500 ring-2 ring-indigo-500/30'
                                                    : 'border-transparent hover:border-gray-300 dark:hover:border-gray-600'
                                                    }`}
                                            >
                                                {activeTab === 'image' ? (
                                                    <img
                                                        src={asset.url || ''}
                                                        alt={asset.title}
                                                        className="w-full h-full object-cover"
                                                    />
                                                ) : (
                                                    <video
                                                        src={asset.url || ''}
                                                        className="w-full h-full object-cover pointer-events-none"
                                                    />
                                                )}
                                                {selectedAsset?.id === asset.id && (
                                                    <div className="absolute inset-0 bg-indigo-500/20 flex items-center justify-center">
                                                        <div className="bg-indigo-500 text-white p-1 rounded-full">
                                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                            </svg>
                                                        </div>
                                                    </div>
                                                )}
                                                <div className="absolute bottom-0 left-0 right-0 bg-black/60 p-1">
                                                    <p className="text-[10px] text-white truncate text-center">{asset.title}</p>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {error && (
                    <div className="p-3 bg-red-100 text-red-700 rounded text-sm">
                        {error}
                    </div>
                )}

                <button
                    onClick={handleGenerate}
                    disabled={isGenerating}
                    className={`w-full py-3 rounded-lg font-medium text-white flex items-center justify-center gap-2 ${isGenerating ? 'bg-indigo-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'
                        }`}
                >
                    {isGenerating ? (
                        <>
                            <Spinner /> {progress || 'Processing...'}
                        </>
                    ) : (
                        <>
                            <IconCube /> Generate World
                        </>
                    )}
                </button>
            </div>

            {generatedWorld && (
                <div className="mt-8 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
                    <h3 className="font-semibold mb-2 dark:text-white">Generated World</h3>
                    <div className="aspect-video bg-black rounded-lg overflow-hidden relative group">
                        <img
                            src={generatedWorld.assets?.thumbnail_url}
                            alt={generatedWorld.display_name}
                            className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <a
                                href={generatedWorld.world_marble_url}
                                target="_blank"
                                rel="noreferrer"
                                className="bg-white text-black px-4 py-2 rounded-full font-medium hover:bg-gray-100"
                            >
                                View in Marble
                            </a>
                        </div>
                    </div>
                    <p className="mt-2 text-sm text-gray-500 text-center">
                        <a href={generatedWorld.world_marble_url} target="_blank" rel="noreferrer" className="underline hover:text-indigo-500">
                            Open interactive viewer
                        </a>
                    </p>
                </div>
            )}
        </div>
    );
};

