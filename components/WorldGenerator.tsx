import React, { useState, useMemo } from 'react';
import { worldLabsService, OperationResponse } from '../services/worldLabsService';
import { AssetItem } from '../types';

interface WorldGeneratorProps {
    onWorldGenerated: (world: OperationResponse) => void;
    onError: (error: string) => void;
    assets: AssetItem[];
}

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

const IconUpload = () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
    </svg>
);

const IconFolder = () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
    </svg>
);

const Spinner = () => (
    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
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
            // Include anything that is logically an image (header, slide, etc, or unknown types that look like images)
            // Excluding clearly non-image types
            return assets.filter(a => {
                const type = a.type;
                if (type === 'video' || type === 'podcast' || type === 'book' || type === 'table' || type === 'leadform' || type === 'doc' || type === 'website' || type === 'blog') return false;
                // If it's a social post, check context? Assuming generic image types here.
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
        setProgress('Initializing...');
        setGeneratedWorld(null);

        try {
            if (!textPrompt) throw new Error('Please describe the world');

            let request: any = {
                world_prompt: {
                    type: activeTab,
                    text_prompt: textPrompt
                }
            };

            // Handle Input Logic
            if (activeTab === 'text') {
                // No extra inputs needed
            } else if (activeTab === 'image') {
                if (inputMode === 'upload') {
                    if (!selectedFile) throw new Error('Please select an image');
                    setProgress('Uploading image...');
                    const mediaId = await worldLabsService.uploadMedia(selectedFile);
                    request.world_prompt.image_prompt = { source: 'media_asset', media_asset_id: mediaId };
                } else {
                    if (!selectedAsset) throw new Error('Please select an image asset');
                    request.world_prompt.image_prompt = { source: 'uri', uri: selectedAsset.url };
                }
            } else if (activeTab === 'multi-image') {
                // Only supporting Asset selection for multi-image for now
                if (selectedAssets.length < 2) throw new Error('Please select at least 2 images (Max 8)');

                request.world_prompt.multi_image_prompt = selectedAssets.map((asset, index) => ({
                    content: {
                        source: 'uri',
                        uri: asset.url
                    },
                    // Simple uniform distribution of azimuth for now
                    azimuth: (360 / selectedAssets.length) * index
                }));

            } else if (activeTab === 'video') {
                request.world_prompt.type = 'video';

                if (inputMode === 'upload') {
                    if (!selectedFile) throw new Error('Please select a video');
                    setProgress('Uploading video...');
                    const mediaId = await worldLabsService.uploadMedia(selectedFile);
                    request.world_prompt.video_prompt = { source: 'media_asset', media_asset_id: mediaId };
                } else {
                    if (!selectedAsset) throw new Error('Please select a video asset');
                    request.world_prompt.video_prompt = { source: 'uri', uri: selectedAsset.url };
                }
            }

            setProgress('Generating world... this can take a minute');
            const result = await worldLabsService.generateWorld(request);
            setGeneratedWorld(result.response);
            onWorldGenerated(result);

        } catch (err: any) {
            console.error(err);
            setError(err.message || 'Failed to generate world');
            onError(err.message);
        } finally {
            setIsGenerating(false);
            setProgress('');
        }
    };

    return (
        <div className="bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-200 dark:border-gray-700/50 shadow-sm p-6 max-w-3xl mx-auto transition-all duration-300">
            <div className="flex items-center gap-3 mb-8">
                <div className="p-3 bg-indigo-100 dark:bg-indigo-900/30 rounded-xl">
                    <IconCube />
                </div>
                <div>
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white">Generate 3D World</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Create immersive interactive 3D environments from text or media.</p>
                </div>
            </div>

            <div className="flex p-1 bg-gray-100 dark:bg-gray-800 rounded-lg mb-8 overflow-x-auto no-scrollbar">
                {[
                    { id: 'text', label: 'Text to World', icon: IconMagic },
                    { id: 'image', label: 'Image to World', icon: IconImage },
                    { id: 'multi-image', label: 'Multi-Image', icon: IconImages },
                    { id: 'video', label: 'Video to World', icon: IconVideo }
                ].map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => {
                            setActiveTab(tab.id as any);
                            if (tab.id !== 'text') setInputMode(tab.id === 'multi-image' ? 'asset' : 'upload');
                        }}
                        className={`flex-1 py-2.5 px-4 rounded-md text-sm font-medium flex items-center justify-center gap-2 transition-all duration-200 whitespace-nowrap ${activeTab === tab.id
                                ? 'bg-white dark:bg-gray-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                                : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                            }`}
                    >
                        <tab.icon /> {tab.label}
                    </button>
                ))}
            </div>

            <div className="space-y-6">
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Description
                    </label>
                    <textarea
                        value={textPrompt}
                        onChange={(e) => setTextPrompt(e.target.value)}
                        placeholder="Describe the world you want to create... (e.g., 'A futuristic city with neon lights under a starry sky')"
                        className="w-full p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 outline-none transition-all resize-y min-h-[100px]"
                        rows={3}
                    />
                </div>

                {(activeTab === 'image' || activeTab === 'video' || activeTab === 'multi-image') && (
                    <div className="bg-gray-50 dark:bg-gray-900/30 rounded-xl p-4 border border-gray-200 dark:border-gray-700/50">
                        <div className="flex items-center justify-between mb-4">
                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
                                {activeTab === 'multi-image' ? 'Select Images' : (activeTab === 'image' ? 'Image Source' : 'Video Source')}
                                {activeTab === 'multi-image' && <span className="text-xs font-normal text-gray-500">(Max 8)</span>}
                            </label>

                            {activeTab !== 'multi-image' && (
                                <div className="flex bg-gray-200 dark:bg-gray-800 rounded-lg p-1">
                                    <button
                                        onClick={() => setInputMode('upload')}
                                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${inputMode === 'upload'
                                            ? 'bg-white dark:bg-gray-600 shadow-sm text-gray-900 dark:text-white'
                                            : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                                            }`}
                                    >
                                        <div className="flex items-center gap-1.5">
                                            <IconUpload /> Upload
                                        </div>
                                    </button>
                                    <button
                                        onClick={() => setInputMode('asset')}
                                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${inputMode === 'asset'
                                            ? 'bg-white dark:bg-gray-600 shadow-sm text-gray-900 dark:text-white'
                                            : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                                            }`}
                                    >
                                        <div className="flex items-center gap-1.5">
                                            <IconFolder /> From Assets
                                        </div>
                                    </button>
                                </div>
                            )}
                        </div>

                        <div className="min-h-[200px] flex flex-col justify-center">
                            {inputMode === 'upload' && activeTab !== 'multi-image' ? (
                                <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-8 transition-colors hover:border-indigo-400 dark:hover:border-indigo-500 group text-center cursor-pointer relative">
                                    <input
                                        type="file"
                                        accept={activeTab === 'image' ? "image/*" : "video/*"}
                                        onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                    />
                                    <div className="flex flex-col items-center gap-3">
                                        <div className="p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-full group-hover:scale-110 transition-transform duration-300">
                                            <IconUpload />
                                        </div>
                                        <div>
                                            <p className="font-medium text-gray-700 dark:text-gray-200">
                                                {selectedFile ? selectedFile.name : `Click to upload ${activeTab}`}
                                            </p>
                                            {!selectedFile && <p className="text-xs text-gray-500 mt-1">or drag and drop</p>}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-2 w-full">
                                    {compatibleAssets.length === 0 ? (
                                        <div className="h-[200px] flex flex-col items-center justify-center text-center p-4 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl">
                                            <div className="p-3 bg-gray-100 dark:bg-gray-800 rounded-full mb-3 text-gray-400">
                                                <IconFolder />
                                            </div>
                                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                                No compatible {activeTab === 'video' ? 'videos' : 'images'} found in your assets.
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 max-h-[240px] overflow-y-auto p-1 custom-scrollbar">
                                            {compatibleAssets.map(asset => {
                                                const isSelected = activeTab === 'multi-image'
                                                    ? selectedAssets.some(a => a.id === asset.id)
                                                    : selectedAsset?.id === asset.id;

                                                const selectIndex = activeTab === 'multi-image'
                                                    ? selectedAssets.findIndex(a => a.id === asset.id)
                                                    : -1;

                                                return (
                                                    <button
                                                        key={asset.id}
                                                        onClick={() => handleAssetToggle(asset)}
                                                        className={`relative aspect-square rounded-xl overflow-hidden border-2 transition-all duration-200 group ${isSelected
                                                            ? 'border-indigo-500 ring-4 ring-indigo-500/10 scale-[0.98]'
                                                            : 'border-transparent hover:border-gray-300 dark:hover:border-gray-600 hover:scale-[1.02]'
                                                            }`}
                                                    >
                                                        {activeTab === 'video' ? (
                                                            <video
                                                                src={asset.url || ''}
                                                                className="w-full h-full object-cover pointer-events-none"
                                                            />
                                                        ) : (
                                                            <img
                                                                src={asset.url || ''}
                                                                alt={asset.title}
                                                                className="w-full h-full object-cover"
                                                            />
                                                        )}

                                                        <div className={`absolute inset-0 transition-colors ${isSelected ? 'bg-indigo-900/20' : 'group-hover:bg-black/10'}`} />

                                                        {isSelected && (
                                                            <div className="absolute inset-0 flex items-center justify-center anim-pop-in">
                                                                <div className="bg-indigo-600 text-white w-8 h-8 flex items-center justify-center rounded-full text-sm font-bold shadow-lg ring-2 ring-white dark:ring-gray-900 transform transition-transform">
                                                                    {activeTab === 'multi-image' ? selectIndex + 1 : (
                                                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                                                        </svg>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        )}
                                                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2 pt-6 opacity-0 group-hover:opacity-100 transition-opacity">
                                                            <p className="text-[10px] text-white truncate text-center font-medium">{asset.title}</p>
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {error && (
                    <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex items-start gap-3">
                        <svg className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
                    </div>
                )}

                <button
                    onClick={handleGenerate}
                    disabled={isGenerating}
                    className={`group w-full py-4 rounded-xl font-semibold text-white flex items-center justify-center gap-3 transition-all duration-300 ${isGenerating
                            ? 'bg-gray-400 cursor-not-allowed opacity-75'
                            : 'bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 shadow-lg hover:shadow-indigo-500/25 hover:-translate-y-0.5'
                        }`}
                >
                    {isGenerating ? (
                        <>
                            <Spinner />
                            <span className="font-medium animate-pulse">{progress || 'Creating your world...'}</span>
                        </>
                    ) : (
                        <>
                            <IconCube />
                            <span>Generate World</span>
                            <svg className="w-5 h-5 opacity-70 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
                        </>
                    )}
                </button>
            </div>

            {generatedWorld && (
                <div className="mt-8 overflow-hidden bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-xl anim-slide-up">
                    <div className="p-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/50 flex items-center justify-between">
                        <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                            Generation Complete
                        </h3>
                        <span className="text-xs text-gray-500 font-mono bg-gray-200 dark:bg-gray-700 px-2 py-1 rounded">{generatedWorld?.display_name || 'World Generated'}</span>
                    </div>
                    <div className="aspect-video bg-black relative group">
                        <img
                            src={generatedWorld?.assets?.thumbnail_url}
                            alt={generatedWorld?.display_name}
                            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center backdrop-blur-sm">
                            <a
                                href={generatedWorld?.world_marble_url}
                                target="_blank"
                                rel="noreferrer"
                                className="transform translate-y-4 group-hover:translate-y-0 transition-transform duration-300 bg-white text-black px-6 py-3 rounded-full font-bold shadow-2xl hover:bg-gray-100 flex items-center gap-2"
                            >
                                <IconCube /> Open 3D Viewer
                            </a>
                        </div>
                    </div>
                    <div className="p-4 bg-gray-50 dark:bg-gray-800/30 flex justify-between items-center text-sm">
                        <span className="text-gray-500 truncate max-w-[200px]">{generatedWorld?.display_name}</span>
                        <a href={generatedWorld?.world_marble_url} target="_blank" rel="noreferrer" className="text-indigo-600 dark:text-indigo-400 hover:underline">
                            Open in Fullscreen &rarr;
                        </a>
                    </div>
                </div>
            )}
        </div>
    );
};
