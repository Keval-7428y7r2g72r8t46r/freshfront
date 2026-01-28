import { doc, getDoc } from 'firebase/firestore';
import { db, auth } from './firebase';

export interface ModelConfig {
  primary: string;
  secondary: string;
  image: string;
}

const FREE_MODELS: ModelConfig = {
  primary: 'gemini-2.5-pro',
  secondary: 'gemini-2.5-flash',
  image: 'gemini-2.5-flash-image',
};

const PRO_MODELS: ModelConfig = {
  primary: 'gemini-3-pro-preview',
  secondary: 'gemini-2.5-flash',
  image: 'gemini-3-pro-image-preview',
};

let cachedSubscriptionStatus: boolean | null = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 60000;

export async function isUserSubscribed(): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) return false;

  const now = Date.now();
  if (cachedSubscriptionStatus !== null && (now - cacheTimestamp) < CACHE_DURATION) {
    return cachedSubscriptionStatus;
  }

  try {
    const userRef = doc(db, 'users', user.uid);
    const userDoc = await getDoc(userRef);
    
    if (userDoc.exists()) {
      cachedSubscriptionStatus = userDoc.data()?.subscribed || false;
      cacheTimestamp = now;
      return cachedSubscriptionStatus;
    }
    
    cachedSubscriptionStatus = false;
    cacheTimestamp = now;
    return false;
  } catch (error) {
    console.error('Error checking subscription status:', error);
    return cachedSubscriptionStatus ?? false;
  }
}

export function clearSubscriptionCache(): void {
  cachedSubscriptionStatus = null;
  cacheTimestamp = 0;
}

export async function getModelConfig(): Promise<ModelConfig> {
  const isSubscribed = await isUserSubscribed();
  return isSubscribed ? PRO_MODELS : FREE_MODELS;
}

export async function getPrimaryModel(): Promise<string> {
  const config = await getModelConfig();
  return config.primary;
}

export async function getSecondaryModel(): Promise<string> {
  const config = await getModelConfig();
  return config.secondary;
}

export async function getImageModel(): Promise<string> {
  const config = await getModelConfig();
  return config.image;
}

export function isRateLimitError(error: any): boolean {
  if (!error) return false;
  
  const errorMessage = error.message?.toLowerCase() || '';
  const errorString = String(error).toLowerCase();
  
  return (
    error.status === 429 ||
    errorMessage.includes('429') ||
    errorMessage.includes('rate limit') ||
    errorMessage.includes('quota exceeded') ||
    errorMessage.includes('resource exhausted') ||
    errorMessage.includes('resourceexhausted') ||
    errorString.includes('429') ||
    errorString.includes('rate limit') ||
    errorString.includes('quota')
  );
}
