import React, { useEffect, useRef, useState } from 'react';
import { WebGLRenderer, Scene, PerspectiveCamera, Clock, Color } from 'three';
import { SparkRenderer, SplatMesh, SparkControls } from '@sparkjsdev/spark';
import { WorldAsset } from '../types';

interface WorldViewerProps {
    world: WorldAsset;
    onClose: () => void;
}

export const WorldViewer: React.FC<WorldViewerProps> = ({ world, onClose }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!containerRef.current) return;

        let renderer: WebGLRenderer | null = null;
        let scene: Scene | null = null;
        let camera: PerspectiveCamera | null = null;
        let spark: SparkRenderer | null = null;
        let controls: SparkControls | null = null;
        let animationId: number | null = null;

        const handleResize = () => {
            if (!containerRef.current || !camera || !renderer) return;
            const w = containerRef.current.clientWidth;
            const h = containerRef.current.clientHeight;
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);
        };

        const init = async () => {
            try {
                // Find the splat URL from World Labs response structure
                const findAssetUrl = (obj: any): string => {
                    if (typeof obj === 'string') {
                        const low = obj.toLowerCase();
                        if (low.endsWith('.spz') || low.endsWith('.ply')) return obj;
                    } else if (typeof obj === 'object' && obj !== null) {
                        // Check for spz_urls with resolution options (World Labs structure)
                        if (obj.spz_urls) {
                            // Prefer full_res, then 500k, then 100k
                            if (obj.spz_urls.full_res) return obj.spz_urls.full_res;
                            if (obj.spz_urls['500k']) return obj.spz_urls['500k'];
                            if (obj.spz_urls['100k']) return obj.spz_urls['100k'];
                        }

                        // Priority to names like 'spz', 'ply', 'splat'
                        const keys = Object.keys(obj);
                        for (const key of ['spz', 'ply', 'splat', 'url', 'stream_url']) {
                            if (typeof obj[key] === 'string') {
                                const val = obj[key].toLowerCase();
                                if (val.endsWith('.spz') || val.endsWith('.ply')) return obj[key];
                            }
                        }

                        // Recursively search nested objects
                        for (const value of Object.values(obj)) {
                            const result = findAssetUrl(value);
                            if (result) return result;
                        }
                    }
                    return '';
                };

                let splatUrl = '';

                // Handle nested data structure from World Labs API
                const worldData = world.data?.data || world.data;

                if (worldData?.assets) {
                    splatUrl = findAssetUrl(worldData.assets);
                }

                if (!splatUrl) {
                    console.error('No 3D asset found in world data:', world);
                    setError(`No 3D asset found. Please use the fallback link below to view in browser.`);
                    setLoading(false);
                    return;
                }

                console.log('[WorldViewer] Loading splat from:', splatUrl);

                // Proxy the URL through our backend to bypass CORS
                const proxiedUrl = `/api/media?op=proxy-world-asset&url=${encodeURIComponent(splatUrl)}`;
                console.log('[WorldViewer] Using proxied URL:', proxiedUrl);

                // Setup THREE.js
                scene = new Scene();
                scene.background = new Color(0x000000);

                const width = containerRef.current!.clientWidth;
                const height = containerRef.current!.clientHeight;

                camera = new PerspectiveCamera(60, width / height, 0.1, 1000);
                camera.position.set(0, 1, 3);

                renderer = new WebGLRenderer({ antialias: false });
                renderer.setSize(width, height);
                renderer.setPixelRatio(window.devicePixelRatio);
                containerRef.current!.appendChild(renderer.domElement);

                // Controls
                controls = new SparkControls({ canvas: renderer.domElement });

                // Spark Renderer
                spark = new SparkRenderer({ renderer });
                scene.add(spark);

                // Load Splat using proxied URL
                const splat = new SplatMesh({ url: proxiedUrl });
                scene.add(splat);

                await splat.initialized;
                setLoading(false);

                // Center camera roughly - usually splats are at 0,0,0
                // splat.position.set(0, 0, 0);

                const clock = new Clock();

                renderer.setAnimationLoop(() => {
                    if (!renderer || !scene || !camera || !controls) return;

                    const delta = clock.getDelta();
                    controls.update(camera);
                    renderer.render(scene, camera);
                });

                window.addEventListener('resize', handleResize);

            } catch (e: any) {
                console.error('Failed to init WorldViewer:', e);
                setError(e.message || 'Failed to load 3D viewer. Please use the fallback link below.');
                setLoading(false);
            }
        };

        init();

        return () => {
            window.removeEventListener('resize', handleResize);
            if (renderer) {
                renderer.setAnimationLoop(null);
                renderer.dispose();
                containerRef.current?.removeChild(renderer.domElement);
            }
            if (spark) (spark as any).dispose?.();
            if (controls) (controls as any).dispose?.();
            scene?.clear();
        };
    }, [world]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md">
            <div className="relative w-full h-full max-w-7xl max-h-[90vh] mx-auto p-4 flex flex-col">

                {/* Header */}
                <div className="flex items-center justify-between mb-2 text-white">
                    <h2 className="text-lg font-semibold truncate">{world.prompt}</h2>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-white/10 rounded-full transition-colors"
                        title="Close Viewer"
                    >
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* 3D Container */}
                <div ref={containerRef} className="flex-1 w-full bg-black rounded-xl overflow-hidden relative border border-white/10">
                    {loading && (
                        <div className="absolute inset-0 flex items-center justify-center text-white bg-black/50 z-10">
                            <div className="flex flex-col items-center gap-2">
                                <svg className="w-8 h-8 animate-spin text-indigo-500" viewBox="0 0 24 24" fill="none">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                </svg>
                                <span>Loading 3D World...</span>
                            </div>
                        </div>
                    )}

                    {error && (
                        <div className="absolute inset-0 flex items-center justify-center text-red-500 bg-black/80 z-20">
                            <div className="text-center p-6 bg-gray-900 rounded-xl border border-red-500/20 max-w-md">
                                <p className="font-semibold mb-2">Error</p>
                                <p className="mb-1">{error}</p>
                                {(world.data?.data?.world_marble_url || world.data?.world_marble_url) && (
                                    <a
                                        href={world.data?.data?.world_marble_url || world.data?.world_marble_url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="mt-4 inline-block px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg text-sm transition-colors text-white font-medium"
                                    >
                                        🌍 Open in World Labs Viewer
                                    </a>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Controls Hint */}
                <div className="mt-2 text-center text-xs text-white/50">
                    Left Click: Rotate • Right Click: Pan • Scroll: Zoom • Arrow Keys: Look/Move
                </div>
            </div>
        </div>
    );
};
