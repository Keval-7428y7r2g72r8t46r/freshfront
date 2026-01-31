import React, { useState } from 'react';
import { createPortal } from 'react-dom';

interface GameCenterProps {
    isOpen: boolean;
    onClose: () => void;
    isDarkMode: boolean;
}

interface GameOption {
    id: string;
    name: string;
    icon: string;
    url: string;
    description: string;
}

const GAMES: GameOption[] = [
    {
        id: 'pacman',
        name: 'Pacman',
        icon: '👻',
        url: 'https://www.google.com/logos/2010/pacman10-i.html',
        description: 'Classic arcade maze game'
    },
    {
        id: 'tetris',
        name: 'Tetris',
        icon: '🧱',
        url: 'https://chvin.github.io/react-tetris/',
        description: 'Stack falling blocks'
    },
    {
        id: 'snake',
        name: 'Snake',
        icon: '🐍',
        url: 'https://playsnake.org/',
        description: 'Classic snake game'
    },
    {
        id: 'pong',
        name: 'Pong',
        icon: '🏓',
        url: 'https://www.ponggame.org/',
        description: 'Classic paddle game'
    },
    {
        id: 'flappybird',
        name: 'Flappy Bird',
        icon: '🐦',
        url: 'https://flappybird.io/',
        description: 'Tap to fly through pipes'
    },
    {
        id: 'asteroids',
        name: 'Asteroids',
        icon: '🚀',
        url: 'https://www.echalk.co.uk/amusements/Games/asteroidsaliean/asteroidsaliean.html',
        description: 'Shoot space rocks'
    }
];

export const GameCenter: React.FC<GameCenterProps> = ({ isOpen, onClose, isDarkMode }) => {
    const [selectedGame, setSelectedGame] = useState<GameOption | null>(null);

    if (!isOpen) return null;

    const handleGameSelect = (game: GameOption) => {
        setSelectedGame(game);
    };

    const handleCloseGame = () => {
        setSelectedGame(null);
    };

    const handleCloseAll = () => {
        setSelectedGame(null);
        onClose();
    };

    // Fullscreen Game View
    if (selectedGame) {
        return createPortal(
            <div className="fixed inset-0 z-[9999] bg-black flex flex-col">
                {/* Header Bar */}
                <div className="flex items-center justify-between px-4 py-3 bg-[#1d1d1f] border-b border-[#3d3d3f]">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleCloseGame}
                            className="p-2 rounded-xl bg-[#2d2d2f] hover:bg-[#3d3d3f] text-white transition-colors"
                            title="Back to Games"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                        </button>
                        <span className="text-2xl">{selectedGame.icon}</span>
                        <span className="text-white font-semibold text-lg">{selectedGame.name}</span>
                    </div>
                    <button
                        onClick={handleCloseAll}
                        className="p-2 rounded-xl bg-red-500/20 hover:bg-red-500/40 text-red-400 hover:text-red-300 transition-colors"
                        title="Close Game Center"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                {/* Game iframe */}
                <iframe
                    src={selectedGame.url}
                    className="flex-1 w-full border-none"
                    title={selectedGame.name}
                    allow="autoplay; fullscreen"
                />
            </div>,
            document.body
        );
    }

    // Game Selection Modal
    return createPortal(
        <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                onClick={onClose}
            />
            {/* Modal */}
            <div className={`relative z-10 w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden ${isDarkMode ? 'bg-[#1d1d1f] border border-[#3d3d3f]' : 'bg-white border border-gray-200'}`}>
                {/* Header */}
                <div className={`flex items-center justify-between px-6 py-4 border-b ${isDarkMode ? 'border-[#3d3d3f]' : 'border-gray-200'}`}>
                    <div className="flex items-center gap-3">
                        <span className="text-3xl">🎮</span>
                        <h2 className={`text-xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Game Center</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className={`p-2 rounded-full transition-colors ${isDarkMode ? 'hover:bg-white/10 text-gray-400 hover:text-white' : 'hover:bg-gray-100 text-gray-500 hover:text-gray-900'}`}
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                {/* Game Grid */}
                <div className="p-6">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                        {GAMES.map((game) => (
                            <button
                                key={game.id}
                                onClick={() => handleGameSelect(game)}
                                className={`group relative p-5 rounded-2xl text-left transition-all duration-300 hover:scale-[1.03] ${isDarkMode
                                    ? 'bg-[#2d2d2f] hover:bg-[#3d3d3f] border border-[#3d3d3f] hover:border-[#5d5d5f]'
                                    : 'bg-gray-50 hover:bg-gray-100 border border-gray-200 hover:border-gray-300'
                                    }`}
                            >
                                <span className="text-4xl block mb-3 group-hover:scale-110 transition-transform">{game.icon}</span>
                                <h3 className={`font-semibold text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{game.name}</h3>
                                <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>{game.description}</p>
                            </button>
                        ))}
                    </div>
                </div>
                {/* Footer */}
                <div className={`px-6 py-4 border-t text-center ${isDarkMode ? 'border-[#3d3d3f]' : 'border-gray-200'}`}>
                    <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                        Take a break and have some fun! 🎉
                    </p>
                </div>
            </div>
        </div>,
        document.body
    );
};
