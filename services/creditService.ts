import { doc, getDoc, setDoc, updateDoc, increment } from 'firebase/firestore';
import { db, auth } from './firebase';

// ============================================================================
// CREDIT CONSTANTS
// ============================================================================

export const DEFAULT_CREDITS = 125;
export const PRO_SUBSCRIPTION_CREDITS = 2500;

/**
 * Credit costs for all AI features.
 * These values determine how many credits are deducted per operation.
 */
export const CREDIT_COSTS = {
    // Minimal (1 credit) - High frequency, low cost
    inlineAiAsk: 1,

    // Low cost (2 credits)
    aiTableEdit: 2,
    aiDocEdit: 2,
    quickNoteGeneration: 2,
    noteEnhancement: 2,

    // Low-Medium (5 credits)
    seoSearch: 5,
    socialPostGeneration: 5,

    // Medium (10-15 credits)
    blogGeneration: 10,
    websiteEdit: 10,
    tableGeneration: 15,
    docGeneration: 15,

    // Standard (20-25 credits)
    podcastGeneration: 20,
    videoSequenceGeneration: 20,
    imageGenerationFast: 20,
    imageGenerationPro: 25,
    podcastShort: 25,

    // Higher (30-35 credits)
    podcastMedium: 30,
    videoClipGeneration: 35,

    // Premium (40-45 credits)
    podcastLong: 40,
    bookGeneration: 40,
    formGeneration: 45,
    researchSession: 45,

    // High (50-60 credits)
    websiteGeneration: 50,
    magicProjectGeneration: 50,
    deepResearch: 60,

    // Highest (70 credits)
    videoOverviewGeneration: 70,

    // New Operations
    videoEdition: 35,
    worldGeneration: 50,
    videoLive: 35,
    videoEditXai: 35,
} as const;

export type CreditOperation = keyof typeof CREDIT_COSTS;

export interface CreditBalance {
    credits: number;
    creditsLastUpdated: string;
}

// ============================================================================
// UNLIMITED PLAN FEATURES
// ============================================================================

/**
 * Operations that are FREE for unlimited subscribers even after credits run out.
 * These are the premium features that define the Unlimited tier:
 * - Deep Research
 * - Image & Video Generation
 * - Browser Automation (included in research)
 * - Podcasts
 * - Social Media Scheduling (no credit cost anyway)
 * - Email Campaigns
 */
export const UNLIMITED_BYPASS_OPERATIONS: Set<CreditOperation> = new Set([
    // Deep Research
    'deepResearch',
    'researchSession',

    // Image Generation
    'imageGenerationFast',
    'imageGenerationPro',

    // Video Generation
    'videoSequenceGeneration',
    'videoClipGeneration',
    'videoOverviewGeneration',

    // Podcasts
    'podcastGeneration',
    'podcastShort',
    'podcastMedium',
    'podcastLong',

    // Social/Email (these support campaigns)
    'socialPostGeneration',
]);

/**
 * Check if the current user has an unlimited subscription.
 * Returns true if the user has unlimited=true in their Firestore document.
 */
export async function isUnlimitedUser(): Promise<boolean> {
    const user = auth.currentUser;
    if (!user) return false;

    try {
        const userRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userRef);

        if (userDoc.exists()) {
            const data = userDoc.data();
            return data.unlimited === true;
        }

        return false;
    } catch (error) {
        console.error('Error checking unlimited status:', error);
        return false;
    }
}

// ============================================================================
// CREDIT FUNCTIONS
// ============================================================================

/**
 * Get the current user's credit balance.
 * Returns 0 if user is not logged in or has no credits field.
 */
export async function getUserCredits(): Promise<number> {
    const user = auth.currentUser;
    if (!user) return 0;

    try {
        const userRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userRef);

        if (userDoc.exists()) {
            const data = userDoc.data();
            return data.credits ?? 0;
        }

        return 0;
    } catch (error) {
        console.error('Error fetching user credits:', error);
        return 0;
    }
}

/**
 * Check if the current user has enough credits for a specific operation.
 * Unlimited subscribers automatically pass for UNLIMITED_BYPASS_OPERATIONS.
 */
export async function hasEnoughCredits(operation: CreditOperation): Promise<boolean> {
    // Check if this operation is covered by unlimited plan
    if (UNLIMITED_BYPASS_OPERATIONS.has(operation)) {
        const unlimited = await isUnlimitedUser();
        if (unlimited) {
            console.log(`Unlimited user bypass for operation: ${operation}`);
            return true;
        }
    }

    const credits = await getUserCredits();
    const cost = CREDIT_COSTS[operation];
    return credits >= cost;
}

/**
 * Get the cost of a specific operation.
 */
export function getCreditCost(operation: CreditOperation): number {
    return CREDIT_COSTS[operation];
}

/**
 * Deduct credits for a specific operation.
 * Returns true if successful, false if insufficient credits or error.
 * 
 * IMPORTANT: This should be called BEFORE performing the AI operation.
 * Unlimited subscribers skip deduction for UNLIMITED_BYPASS_OPERATIONS.
 */
export async function deductCredits(operation: CreditOperation): Promise<boolean> {
    const user = auth.currentUser;
    if (!user) return false;

    // Check if this operation is covered by unlimited plan - if so, skip deduction
    if (UNLIMITED_BYPASS_OPERATIONS.has(operation)) {
        const unlimited = await isUnlimitedUser();
        if (unlimited) {
            console.log(`Unlimited user - skipping credit deduction for: ${operation}`);
            return true;
        }
    }

    const cost = CREDIT_COSTS[operation];

    try {
        const userRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userRef);

        if (!userDoc.exists()) {
            console.error('User document does not exist');
            return false;
        }

        const currentCredits = userDoc.data().credits ?? 0;

        if (currentCredits < cost) {
            console.warn(`Insufficient credits: have ${currentCredits}, need ${cost}`);
            return false;
        }

        // Atomically decrement credits
        await updateDoc(userRef, {
            credits: increment(-cost),
            creditsLastUpdated: new Date().toISOString(),
        });

        console.log(`Deducted ${cost} credits for ${operation}. Remaining: ${currentCredits - cost}`);
        return true;
    } catch (error) {
        console.error('Error deducting credits:', error);
        return false;
    }
}

/**
 * Add credits to the current user's account.
 * Used primarily by the Stripe webhook on subscription.
 */
export async function addCredits(amount: number): Promise<boolean> {
    const user = auth.currentUser;
    if (!user) return false;

    try {
        const userRef = doc(db, 'users', user.uid);

        await updateDoc(userRef, {
            credits: increment(amount),
            creditsLastUpdated: new Date().toISOString(),
        });

        console.log(`Added ${amount} credits to user ${user.uid}`);
        return true;
    } catch (error) {
        console.error('Error adding credits:', error);
        return false;
    }
}

/**
 * Initialize credits for a new user.
 * This is called when a user document is first created.
 * 
 * @param userId - The Firebase user ID
 * @param amount - Initial credit amount (defaults to DEFAULT_CREDITS = 125)
 */
export async function initializeUserCredits(
    userId: string,
    amount: number = DEFAULT_CREDITS
): Promise<boolean> {
    try {
        const userRef = doc(db, 'users', userId);

        await setDoc(userRef, {
            credits: amount,
            creditsLastUpdated: new Date().toISOString(),
        }, { merge: true });

        console.log(`Initialized ${amount} credits for user ${userId}`);
        return true;
    } catch (error) {
        console.error('Error initializing user credits:', error);
        return false;
    }
}

/**
 * Get a human-readable name for a credit operation.
 */
export function getOperationDisplayName(operation: CreditOperation): string {
    const names: Record<CreditOperation, string> = {
        inlineAiAsk: 'Inline AI Ask',
        aiTableEdit: 'AI Table Edit',
        aiDocEdit: 'AI Document Edit',
        quickNoteGeneration: 'Quick Note Generation',
        noteEnhancement: 'Note Enhancement',
        seoSearch: 'SEO Search',
        socialPostGeneration: 'Social Post Generation',
        blogGeneration: 'Blog Generation',
        websiteEdit: 'AI Website Edit',
        tableGeneration: 'Table Generation',
        docGeneration: 'Document Generation',
        podcastGeneration: 'Podcast Generation',
        videoSequenceGeneration: 'Video Sequence',
        imageGenerationFast: 'Image Generation (Fast)',
        imageGenerationPro: 'Image Generation (Pro)',
        podcastShort: 'Short Podcast',
        podcastMedium: 'Medium Podcast',
        podcastLong: 'Long Podcast',
        videoClipGeneration: 'Video Clip',
        bookGeneration: 'Book Generation',
        formGeneration: 'Form Generation',
        researchSession: 'Research Session',
        websiteGeneration: 'Website Generation',
        magicProjectGeneration: 'Magic Project',
        deepResearch: 'Deep Research',
        videoOverviewGeneration: 'Video Overview',
        videoEdition: 'Video Editing',
        worldGeneration: 'World Generation',
        videoLive: 'Live Video Session',
        videoEditXai: 'Video Editing (xAI)',
    };
    return names[operation] || operation;
}

/**
 * Check credits and show a modal if insufficient.
 * Returns true if the user has enough credits, false otherwise.
 * 
 * @param operation - The operation to check
 * @param showInsufficientModal - Callback to show the "not enough credits" modal
 */
export async function checkCreditsWithModal(
    operation: CreditOperation,
    showInsufficientModal: (operation: CreditOperation, needed: number, current: number) => void
): Promise<boolean> {
    const credits = await getUserCredits();
    const cost = CREDIT_COSTS[operation];

    if (credits < cost) {
        showInsufficientModal(operation, cost, credits);
        return false;
    }

    return true;
}
