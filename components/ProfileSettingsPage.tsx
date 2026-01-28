import React, { useState, useEffect, useRef } from 'react';
import { storageService } from '../services/storageService';
import { UserProfile, ResearchProject } from '../types';
import { auth } from '../services/firebase';

interface ProfileSettingsPageProps {
    isDarkMode: boolean;
    currentProject: ResearchProject | null;
}

export const ProfileSettingsPage: React.FC<ProfileSettingsPageProps> = ({ isDarkMode, currentProject }) => {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [profile, setProfile] = useState<UserProfile>({});
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Load profile on mount
    useEffect(() => {
        const loadProfile = async () => {
            try {
                setLoading(true);
                const data = await storageService.getUserProfile();
                if (data) {
                    setProfile(data);
                } else if (auth.currentUser) {
                    // Fallback to auth defaults if no profile doc exists
                    setProfile({
                        displayName: auth.currentUser.displayName || '',
                        photoURL: auth.currentUser.photoURL || '',
                        email: auth.currentUser.email || ''
                    });
                }
            } catch (e) {
                console.error("Failed to load profile", e);
                setMessage({ type: 'error', text: 'Failed to load profile' });
            } finally {
                setLoading(false);
            }
        };
        loadProfile();
    }, []);

    const goBack = () => {
        if (typeof window === 'undefined') return;
        window.history.pushState({}, '', '/');
        window.dispatchEvent(new PopStateEvent('popstate'));
    };

    const goToDDI = () => {
        if (typeof window === 'undefined') return;
        window.history.pushState({}, '', '/ddi');
        window.dispatchEvent(new PopStateEvent('popstate'));
    };

    const handleSave = async () => {
        try {
            setSaving(true);
            setMessage(null);
            await storageService.updateUserProfile(profile);
            setMessage({ type: 'success', text: 'Profile updated successfully' });

            // Clear success message after 3s
            setTimeout(() => setMessage(null), 3000);
        } catch (e) {
            console.error("Failed to update profile", e);
            setMessage({ type: 'error', text: 'Failed to save changes' });
        } finally {
            setSaving(false);
        }
    };

    const handleExportData = () => {
        if (!currentProject) return;

        // Export the full project object including all sub-collections
        const payload = {
            ...currentProject,
            exportMetadata: {
                exportedAt: Date.now(),
                exportedBy: profile.email || 'unknown',
                appVersion: '1.0.0'
            }
        };

        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${currentProject.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}_full_export.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            // Basic validation
            if (file.size > 5 * 1024 * 1024) {
                setMessage({ type: 'error', text: 'Image must be under 5MB' });
                return;
            }

            try {
                setSaving(true); // Show loading state on avatar
                const url = await storageService.uploadProfileImage(file);
                setProfile(prev => ({ ...prev, photoURL: url }));
                // Auto-save the new URL to profile
                await storageService.updateUserProfile({ ...profile, photoURL: url });
                setMessage({ type: 'success', text: 'Profile picture updated' });
                setTimeout(() => setMessage(null), 3000);
            } catch (error) {
                console.error("Failed to upload image", error);
                setMessage({ type: 'error', text: 'Failed to upload image' });
            } finally {
                setSaving(false);
            }
        }
    };

    // UI Theme classes
    const ui = {
        page: isDarkMode ? 'bg-[#000000] text-white' : 'bg-gray-50 text-gray-900',
        card: isDarkMode
            ? 'bg-[#1c1c1e] border border-[#3a3a3c]/70 shadow-xl shadow-black/20'
            : 'bg-white border border-gray-200 shadow-sm',
        input: isDarkMode
            ? 'bg-[#2c2c2e] border-[#3a3a3c] text-white focus:border-[#0a84ff] placeholder-[#636366]'
            : 'bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500 placeholder-gray-400',
        label: isDarkMode ? 'text-[#86868b]' : 'text-gray-600',
        heading: isDarkMode ? 'text-white' : 'text-gray-900',
        subtext: isDarkMode ? 'text-[#636366]' : 'text-gray-500',
        buttonPrimary: 'bg-[#0071e3] hover:bg-[#0077ed] text-white shadow-lg shadow-blue-500/30',
        buttonSecondary: isDarkMode
            ? 'bg-[#2c2c2e] hover:bg-[#3a3a3c] text-white border border-[#3a3a3c]'
            : 'bg-white hover:bg-gray-50 text-gray-700 border border-gray-300',
    };

    return (
        <div className={`min-h-screen h-screen overflow-y-auto ${ui.page} font-sans selection:bg-blue-500/30`}>
            <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-16">

                {/* Header */}
                <div className="flex items-center justify-between gap-4 mb-10">
                    <div>
                        <button
                            onClick={goBack}
                            className={`mb-4 flex items-center gap-2 text-sm font-medium transition-colors ${isDarkMode ? 'text-[#0a84ff] hover:text-[#409cff]' : 'text-[#0071e3] hover:text-[#0077ed]'}`}
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
                            </svg>
                            <span>Back to Projects</span>
                        </button>
                        <h1 className={`text-3xl sm:text-4xl font-bold tracking-tight ${ui.heading}`}>Profile Settings</h1>
                        <p className={`mt-2 text-base ${ui.subtext}`}>Manage your branding and account preferences</p>
                    </div>
                </div>

                {loading ? (
                    <div className="flex flex-col items-center justify-center py-20">
                        <div className="w-8 h-8 border-2 border-[#0071e3] border-t-transparent rounded-full animate-spin"></div>
                    </div>
                ) : (
                    <div className="space-y-6">

                        {/* Branding Card */}
                        <div className={`rounded-3xl p-6 sm:p-8 overflow-hidden relative ${ui.card}`}>

                            <div className="flex flex-col sm:flex-row gap-8">

                                {/* Avatar Section */}
                                <div className="flex-shrink-0">
                                    <div className="relative group mx-auto sm:mx-0 w-28 h-28 sm:w-32 sm:h-32">
                                        <div className={`w-full h-full rounded-full overflow-hidden border-4 transition-all ${isDarkMode ? 'border-[#2c2c2e] group-hover:border-[#3a3a3c]' : 'border-white shadow-md group-hover:border-gray-50'}`}>
                                            {profile.photoURL ? (
                                                <img src={profile.photoURL} alt="Profile" className="w-full h-full object-cover" />
                                            ) : (
                                                <div className={`w-full h-full flex items-center justify-center ${isDarkMode ? 'bg-[#2c2c2e]' : 'bg-gray-100'}`}>
                                                    <svg className={`w-12 h-12 ${isDarkMode ? 'text-[#636366]' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                                    </svg>
                                                </div>
                                            )}
                                        </div>

                                        {/* Overlay for upload */}
                                        <button
                                            onClick={() => fileInputRef.current?.click()}
                                            className="absolute inset-0 flex items-center justify-center bg-black/50 text-white opacity-0 group-hover:opacity-100 rounded-full transition-opacity duration-200 backdrop-blur-sm cursor-pointer"
                                        >
                                            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                                            </svg>
                                        </button>
                                        <input
                                            type="file"
                                            ref={fileInputRef}
                                            onChange={handleFileChange}
                                            className="hidden"
                                            accept="image/png, image/jpeg, image/webp"
                                        />
                                    </div>
                                    <p className={`mt-3 text-xs text-center ${ui.subtext}`}>Tap to change</p>
                                </div>

                                {/* Fields Section */}
                                <div className="flex-1 space-y-5">
                                    <div>
                                        <label className={`block text-sm font-semibold mb-2 ${ui.label}`}>Display Name / Company Name</label>
                                        <input
                                            type="text"
                                            value={profile.displayName || ''}
                                            onChange={e => setProfile(prev => ({ ...prev, displayName: e.target.value }))}
                                            placeholder="e.g. Acme Corp or John Doe"
                                            className={`w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20 transition-all ${ui.input}`}
                                        />
                                    </div>

                                    <div>
                                        <label className={`block text-sm font-semibold mb-2 ${ui.label}`}>
                                            Brand Description / Bio
                                            <span className={`ml-2 text-xs font-normal ${isDarkMode ? 'text-[#0a84ff]' : 'text-[#0071e3]'}`}>
                                                Used by AI agents
                                            </span>
                                        </label>
                                        <textarea
                                            rows={3}
                                            value={profile.description || ''}
                                            onChange={e => setProfile(prev => ({ ...prev, description: e.target.value }))}
                                            placeholder="Describe your brand voice, mission, or personal bio. Agents will use this context to tailor their responses."
                                            className={`w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20 transition-all resize-none ${ui.input}`}
                                        />
                                        <p className={`mt-2 text-xs ${ui.subtext}`}>
                                            Your agents will read this to maintain consistency with your brand identity across projects.
                                        </p>
                                    </div>
                                </div>

                            </div>

                            {/* Footer Actions */}
                            <div className={`mt-8 pt-6 border-t flex justify-end gap-3 ${isDarkMode ? 'border-[#3a3a3c]' : 'border-gray-100'}`}>
                                {message && (
                                    <div className={`flex-1 flex items-center text-sm font-medium ${message.type === 'success' ? 'text-green-500' : 'text-red-500'}`}>
                                        {message.type === 'success' ? (
                                            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                                        ) : (
                                            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                        )}
                                        {message.text}
                                    </div>
                                )}

                                <button
                                    onClick={handleSave}
                                    disabled={saving}
                                    className={`px-6 py-2.5 rounded-full font-medium transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${ui.buttonPrimary}`}
                                >
                                    {saving ? 'Saving...' : 'Save Changes'}
                                </button>
                            </div>

                        </div>

                        {/* Account Info & Data Settings */}
                        <div className={`rounded-3xl p-6 sm:p-8 ${ui.card}`}>
                            <h3 className={`text-lg font-semibold mb-4 ${ui.heading}`}>Account & Data</h3>

                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                                <div>
                                    <div className={`text-sm font-medium mb-1 ${ui.label}`}>Email Address</div>
                                    <div className={`text-base ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{profile.email || 'No email linked'}</div>
                                    <div className={`mt-1 text-xs ${ui.subtext}`}>Managed via Google Auth</div>
                                </div>

                                <div className="flex flex-col items-start sm:items-end gap-2">
                                    {currentProject && (
                                        <button
                                            onClick={handleExportData}
                                            className={`px-5 py-2.5 rounded-full text-sm font-medium transition-colors mb-2 ${ui.buttonSecondary}`}
                                        >
                                            Export Research Data
                                        </button>
                                    )}
                                    <button
                                        onClick={goToDDI}
                                        className={`px-5 py-2.5 rounded-full text-sm font-medium transition-colors ${ui.buttonSecondary}`}
                                    >
                                        Manage Data & Deletion
                                    </button>
                                    <p className={`text-xs max-w-xs sm:text-right ${ui.subtext}`}>
                                        Access your Data Deletion Interface (DDI) to manage or remove your account data.
                                    </p>
                                </div>
                            </div>
                        </div>

                    </div>
                )}
            </div>
        </div>
    );
};
