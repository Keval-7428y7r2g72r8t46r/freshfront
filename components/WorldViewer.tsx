import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
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

        let renderer: THREE.WebGLRenderer | null = null;
        let scene: THREE.Scene | null = null;
        let camera: THREE.PerspectiveCamera | null = null;
        let spark: SparkRenderer | null = null;
        let controls: SparkControls | null = null;
        let animationId: number | null = null;

        const init = async () => {
            try {
                // Find the splat URL
                // The API might return it in various places within 'assets'
                let splatUrl = '';
                if (world.data?.assets) {
                    // Check for explicit splat/ply/spz fields
                    const assets = world.data.assets;

                    // Try to find a URL ending in .spz or .ply
                    // Flatten the simple properties to check
                    const possibleUrls = Object.values(assets).filter(v => typeof v === 'string' && (v.endsWith('.spz') || v.endsWith('.ply')));

                    if (possibleUrls.length > 0) {
                        splatUrl = possibleUrls[0] as string;
                    } else if (assets.stream_url) {
                        splatUrl = assets.stream_url;
                    } else if (assets.splat) {
                        splatUrl = assets.splat;
                    } else if (assets.gaussian_splat) {
                        splatUrl = assets.gaussian_splat;
                    }
                }

                // Fallback: if we just have a marble URL, we might need to assume a convention or fail
                if (!splatUrl && world.data?.world_marble_url) {
                    // Sometimes the world ID can construct the asset URL, but it's risky.
                    // For now, let's try to infer or error.
                    console.warn('No explicit splat URL found in assets:', world.data?.assets);
                    // setError('Could not find 3D asset URL.');
                    // return;
                }

                if (!splatUrl) {
                    // For testing/mocking if we don't have it yet, we might want to alert key details
                    console.log('World Data:', world);
                    setError(`No 3D asset found. (Check console for data)`);
                    setLoading(false);
                    return;
                }

                // Setup THREE.js
                scene = new THREE.Scene();
                scene.background = new THREE.Color(0x000000);

                const width = containerRef.current!.clientWidth;
                const height = containerRef.current!.clientHeight;

                camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
                camera.position.set(0, 1, 3);

                renderer = new THREE.WebGLRenderer({ antialias: false });
                renderer.setSize(width, height);
                renderer.setPixelRatio(window.devicePixelRatio);
                containerRef.current!.appendChild(renderer.domElement);

                // Controls
                controls = new SparkControls({ canvas: renderer.domElement });

                // Spark Renderer
                spark = new SparkRenderer({ renderer });
                scene.add(spark);

                // Load Splat
                const splat = new SplatMesh({ url: splatUrl });
                scene.add(splat);

                await splat.initialized;
                setLoading(false);

                // Center camera roughly - usually splats are at 0,0,0
                // splat.position.set(0, 0, 0);

                const clock = new THREE.Clock();

                renderer.setAnimationLoop(() => {
                    if (!renderer || !scene || !camera || !controls) return;

                    const delta = clock.getDelta();
                    controls.update(delta, camera);
                    renderer.render(scene, camera);
                });

                // Handle resize
                const handleResize = () => {
                    if (!containerRef.current || !camera || !renderer) return;
                    const w = containerRef.current.clientWidth;
                    const h = containerRef.current.clientHeight;
                    camera.aspect = w / h;
                    camera.updateProjectionMatrix();
                    renderer.setSize(w, h);
                };
                window.addEventListener('resize', handleResize);

            } catch (e: any) {
                console.error('Failed to init WorldViewer:', e);
                setError(e.message || 'Failed to load 3D viewer');
                setLoading(false);
            }
        };

        init();

        return () => {
            if (animationId) cancelAnimationFrame(animationId);
            if (renderer) {
                renderer.dispose();
                containerRef.current?.removeChild(renderer.domElement);
            }
            // Cleanup other resources if needed
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
                                <p>{error}</p>
                                {world.data?.world_marble_url && (
                                    <a
                                        href={world.data.world_marble_url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="mt-4 inline-block px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm transition-colors text-white"
                                    >
                                        Open in Browser (Fallback)
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
