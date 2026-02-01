import { initializeApp } from "firebase/app";
import { getAuth, User } from "firebase/auth";
import { getAnalytics } from "firebase/analytics";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  collection,
  getDocs,
  deleteDoc,
  updateDoc,
  serverTimestamp,
  Timestamp,
  query,
  orderBy,
  where,
  limit
} from "firebase/firestore";
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  listAll
} from "firebase/storage";
import { SavedProject, ResearchReport, SavedWebsiteVersion, ResearchProject, SavedResearch, ProjectTask, ProjectNote, KnowledgeBaseFile, ProjectCollaborator, ProjectAccessRole } from "../types";

const firebaseConfig = {
  apiKey: "AIzaSyCrt4pL8ru5NwITTkJ3EDYiPHLeb_aauhk",
  authDomain: "ffresearchr.firebaseapp.com",
  projectId: "ffresearchr",
  storageBucket: "ffresearchr.firebasestorage.app",
  messagingSenderId: "952150939228",
  appId: "1:952150939228:web:30347f717a36fc023c7899",
  measurementId: "G-WL1TMDCTM5"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const analytics = getAnalytics(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Helper function to sanitize data for Firestore (removes undefined values recursively)
// Preserves Firestore FieldValue sentinels (like serverTimestamp()) and handles special objects
const sanitizeForFirestore = (obj: any, seen = new WeakSet()): any => {
  // Handle null/undefined
  if (obj === null || obj === undefined) return null;

  // Handle primitives
  if (typeof obj === 'string') return obj;
  if (typeof obj === 'boolean') return obj;
  if (typeof obj === 'number') {
    // Firestore doesn't accept NaN or Infinity
    if (Number.isNaN(obj) || !Number.isFinite(obj)) return null;
    return obj;
  }

  // Skip functions and symbols - Firestore can't store these
  if (typeof obj === 'function' || typeof obj === 'symbol') {
    return null;
  }

  // Must be an object at this point
  if (typeof obj !== 'object') return null;

  // Detect circular references
  if (seen.has(obj)) {
    console.warn("[sanitizeForFirestore] Circular reference detected, skipping");
    return null;
  }
  seen.add(obj);

  // Preserve Firestore FieldValue sentinels (they have a special _methodName property)
  if (obj._methodName !== undefined || obj.type === 'serverTimestamp') {
    return obj;
  }

  // Handle Date objects - convert to timestamp number for safety
  if (obj instanceof Date) {
    return obj.getTime();
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj
      .map(item => sanitizeForFirestore(item, seen))
      .filter(item => item !== undefined && item !== null);
  }

  // Handle Map objects - convert to plain object
  if (obj instanceof Map) {
    const plainObj: any = {};
    obj.forEach((value, key) => {
      // Only use string keys for Firestore
      if (typeof key === 'string') {
        const sanitizedValue = sanitizeForFirestore(value, seen);
        if (sanitizedValue !== undefined && sanitizedValue !== null) {
          plainObj[key] = sanitizedValue;
        }
      }
    });
    return plainObj;
  }

  // Handle Set objects - convert to array
  if (obj instanceof Set) {
    return Array.from(obj)
      .map(item => sanitizeForFirestore(item, seen))
      .filter(item => item !== undefined && item !== null);
  }

  // Skip other special objects that can't be serialized
  if (obj instanceof RegExp || obj instanceof Error || obj instanceof Promise) {
    return null;
  }

  // Handle plain objects
  const sanitized: any = {};
  for (const [key, value] of Object.entries(obj)) {
    // Skip undefined, functions, and symbols
    if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
      continue;
    }
    const sanitizedValue = sanitizeForFirestore(value, seen);
    if (sanitizedValue !== undefined && sanitizedValue !== null) {
      sanitized[key] = sanitizedValue;
    }
  }
  return sanitized;
};

// ========== USER MANAGEMENT ==========

export interface FirestoreUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  createdAt: Timestamp | null;
  lastLoginAt: Timestamp | null;
  provider: string;
  organizationId?: string | null;
}

// Save user to Firestore "users" collection
export const saveUserToFirestore = async (user: User): Promise<void> => {
  try {
    const userRef = doc(db, "users", user.uid);
    const userDoc = await getDoc(userRef);
    const isNewUser = !userDoc.exists();

    const userData: FirestoreUser & { credits?: number; creditsLastUpdated?: string } = {
      uid: user.uid,
      email: user.email ? user.email.toLowerCase() : null,
      displayName: user.displayName,
      photoURL: user.photoURL,
      createdAt: userDoc.exists() ? userDoc.data().createdAt : serverTimestamp() as Timestamp,
      lastLoginAt: serverTimestamp() as Timestamp,
      provider: user.providerData[0]?.providerId || 'unknown'
    };

    // Grant initial credits to new users (125 credits)
    if (isNewUser) {
      userData.credits = 125;
      userData.creditsLastUpdated = new Date().toISOString();
      console.log("Granting 125 initial credits to new user:", user.uid);
    }

    await setDoc(userRef, userData, { merge: true });
    console.log("User saved to Firestore:", user.uid);
  } catch (error) {
    console.error("Error saving user to Firestore:", error);
    throw error;
  }
};

// Update user profile fields in Firestore
export const updateUserProfileInFirestore = async (uid: string, data: {
  displayName?: string;
  description?: string;
  photoURL?: string;
  themePreference?: 'dark' | 'light' | 'system';
  stripeConnect?: {
    accountId: string;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
    createdAt: number;
  };
}): Promise<void> => {
  try {
    const userRef = doc(db, "users", uid);

    // Filter out undefined values to prevent Firestore errors
    const cleanData = Object.fromEntries(
      Object.entries(data).filter(([_, value]) => value !== undefined)
    );

    await setDoc(userRef, {
      ...cleanData,
      updatedAt: serverTimestamp()
    }, { merge: true });
    console.log("User profile updated in Firestore:", uid);
  } catch (error) {
    console.error("Error updating user profile in Firestore:", error);
    throw error;
  }
};

// Get user from Firestore
export const getUserFromFirestore = async (uid: string): Promise<FirestoreUser | null> => {
  try {
    const userRef = doc(db, "users", uid);
    const userDoc = await getDoc(userRef);

    if (userDoc.exists()) {
      return userDoc.data() as FirestoreUser;
    }
    return null;
  } catch (error) {
    console.error("Error getting user from Firestore:", error);
    return null;
  }
};

// Find a user document by email (used when sharing projects by email).
export const findUserByEmailInFirestore = async (email: string): Promise<FirestoreUser | null> => {
  try {
    const normalized = email.trim().toLowerCase();
    if (!normalized) return null;

    const usersRef = collection(db, "users");
    const q = query(usersRef, where("email", "==", normalized), limit(1));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      return null;
    }

    const docSnap = snapshot.docs[0];
    const data = docSnap.data() as FirestoreUser;
    return {
      ...data,
      uid: docSnap.id,
    };
  } catch (error) {
    console.error("Error finding user by email in Firestore:", error);
    return null;
  }
};

// ========== INTEGRATIONS MANAGEMENT ==========

export const saveTikTokTokens = async (uid: string, tokens: {
  accessToken: string;
  refreshToken: string;
  openId: string;
  expiresAt: number;
  refreshExpiresAt: number;
}): Promise<void> => {
  try {
    const ref = doc(db, "users", uid, "integrations", "tiktok");
    await setDoc(ref, {
      ...tokens,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  } catch (error) {
    console.error("Error saving TikTok tokens to Firestore:", error);
    throw error;
  }
};

export const getTikTokTokens = async (uid: string): Promise<{
  accessToken: string;
  refreshToken: string;
  openId: string;
  expiresAt: number;
  refreshExpiresAt: number;
} | null> => {
  try {
    const ref = doc(db, "users", uid, "integrations", "tiktok");
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return snap.data() as any;
  } catch (error) {
    console.error("Error getting TikTok tokens from Firestore:", error);
    return null;
  }
};

export const deleteTikTokTokens = async (uid: string): Promise<void> => {
  try {
    const ref = doc(db, "users", uid, "integrations", "tiktok");
    await deleteDoc(ref);
  } catch (error) {
    console.error("Error deleting TikTok tokens from Firestore:", error);
    throw error;
  }
};

// Facebook/Instagram token persistence
export const saveFacebookTokens = async (uid: string, tokens: {
  accessToken: string;
  profile?: any;
  pages?: any[];
  selectedPageId?: string;
  igAccounts?: any[];
  selectedIgId?: string;
}): Promise<void> => {
  try {
    const ref = doc(db, "users", uid, "integrations", "facebook");
    await setDoc(ref, {
      ...tokens,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    console.log("[Firebase] Facebook tokens saved");
  } catch (error) {
    console.error("Error saving Facebook tokens to Firestore:", error);
    throw error;
  }
};

export const getFacebookTokens = async (uid: string): Promise<{
  accessToken: string;
  profile?: any;
  pages?: any[];
  selectedPageId?: string;
  igAccounts?: any[];
  selectedIgId?: string;
} | null> => {
  try {
    const ref = doc(db, "users", uid, "integrations", "facebook");
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return snap.data() as any;
  } catch (error) {
    console.error("Error getting Facebook tokens from Firestore:", error);
    return null;
  }
};

export const deleteFacebookTokens = async (uid: string): Promise<void> => {
  try {
    const ref = doc(db, "users", uid, "integrations", "facebook");
    await deleteDoc(ref);
    console.log("[Firebase] Facebook tokens deleted");
  } catch (error) {
    console.error("Error deleting Facebook tokens from Firestore:", error);
    throw error;
  }
};

// ========== REPORTS/PROJECTS MANAGEMENT ==========

// Save a project/report to users/{uid}/reports/{projectId}
export const saveProjectToFirestore = async (uid: string, project: SavedProject): Promise<void> => {
  try {
    const projectRef = doc(db, "users", uid, "reports", project.id);

    // Convert timestamps to Firestore-compatible format
    const projectData = {
      ...project,
      timestamp: project.timestamp,
      lastModified: Date.now(),
      savedAt: serverTimestamp()
    };

    await setDoc(projectRef, projectData, { merge: true });
    console.log("Project saved to Firestore:", project.id);
  } catch (error) {
    console.error("Error saving project to Firestore:", error);
    throw error;
  }
};

// Get all projects for a user from Firestore
export const getProjectsFromFirestore = async (uid: string): Promise<SavedProject[]> => {
  try {
    const reportsRef = collection(db, "users", uid, "reports");
    const q = query(reportsRef, orderBy("lastModified", "desc"));
    const snapshot = await getDocs(q);

    const projects: SavedProject[] = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      projects.push({
        id: doc.id,
        timestamp: data.timestamp,
        lastModified: data.lastModified,
        topic: data.topic,
        researchReport: data.researchReport,
        websiteVersions: data.websiteVersions || []
      } as SavedProject);
    });

    return projects;
  } catch (error) {
    console.error("Error getting projects from Firestore:", error);
    return [];
  }
};

// Get a single project from Firestore
export const getProjectFromFirestore = async (uid: string, projectId: string): Promise<SavedProject | null> => {
  try {
    const projectRef = doc(db, "users", uid, "reports", projectId);
    const projectDoc = await getDoc(projectRef);

    if (projectDoc.exists()) {
      const data = projectDoc.data();
      return {
        id: projectDoc.id,
        timestamp: data.timestamp,
        lastModified: data.lastModified,
        topic: data.topic,
        researchReport: data.researchReport,
        websiteVersions: data.websiteVersions || []
      } as SavedProject;
    }
    return null;
  } catch (error) {
    console.error("Error getting project from Firestore:", error);
    return null;
  }
};

// Update a project in Firestore
export const updateProjectInFirestore = async (uid: string, projectId: string, updates: Partial<SavedProject>): Promise<void> => {
  try {
    const projectRef = doc(db, "users", uid, "reports", projectId);
    await updateDoc(projectRef, {
      ...updates,
      lastModified: Date.now()
    });
    console.log("Project updated in Firestore:", projectId);
  } catch (error) {
    console.error("Error updating project in Firestore:", error);
    throw error;
  }
};

// Delete a project from Firestore
export const deleteProjectFromFirestore = async (uid: string, projectId: string): Promise<void> => {
  try {
    const projectRef = doc(db, "users", uid, "reports", projectId);
    await deleteDoc(projectRef);
    console.log("Project deleted from Firestore:", projectId);
  } catch (error) {
    console.error("Error deleting project from Firestore:", error);
    throw error;
  }
};

// Add website version to a project
export const addWebsiteVersionToFirestore = async (
  uid: string,
  projectId: string,
  html: string,
  description: string
): Promise<SavedWebsiteVersion> => {
  try {
    const projectRef = doc(db, "users", uid, "reports", projectId);
    const projectDoc = await getDoc(projectRef);

    const newVersion: SavedWebsiteVersion = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      html,
      description
    };

    if (projectDoc.exists()) {
      const data = projectDoc.data();
      const versions = data.websiteVersions || [];
      versions.unshift(newVersion);

      await updateDoc(projectRef, {
        websiteVersions: versions,
        lastModified: Date.now()
      });
    }

    console.log("Website version added to Firestore:", newVersion.id);
    return newVersion;
  } catch (error) {
    console.error("Error adding website version to Firestore:", error);
    throw error;
  }
};

// Sync local storage to Firestore (for migration)
export const syncLocalStorageToFirestore = async (uid: string, localProjects: SavedProject[]): Promise<void> => {
  try {
    for (const project of localProjects) {
      await saveProjectToFirestore(uid, project);
    }
    console.log(`Synced ${localProjects.length} projects to Firestore`);
  } catch (error) {
    console.error("Error syncing to Firestore:", error);
    throw error;
  }
};

export const createResearchProjectInFirestore = async (uid: string, project: ResearchProject): Promise<void> => {
  try {
    const projectRef = doc(db, "users", uid, "projects", project.id);
    const projectData = sanitizeForFirestore({
      ...project,
      ownerUid: project.ownerUid || uid,
      researchSessions: project.researchSessions || [],
      tasks: project.tasks || [],
      notes: project.notes || [],
      knowledgeBase: project.knowledgeBase || [],
      aiInsights: project.aiInsights || [],
      suggestedTopics: project.suggestedTopics || [],
      projectConversations: project.projectConversations || [],
      newsArticles: project.newsArticles || [],
      newsLastFetchedAt: project.newsLastFetchedAt || null,
      collaborators: project.collaborators || [],
      savedAt: serverTimestamp(),
      stripeProducts: project.stripeProducts || [],
      emailTemplates: project.emailTemplates || [],
      theme: project.theme || null,
      pinnedAssetIds: project.pinnedAssetIds || [],
      worlds: project.worlds || [],
    });
    await setDoc(projectRef, projectData);
    console.log("Research project created in Firestore:", project.id);
  } catch (error) {
    console.error("Error creating research project:", error);
    throw error;
  }
};

export const getResearchProjectsFromFirestore = async (uid: string): Promise<ResearchProject[]> => {
  try {
    // 1) Owned projects
    const projectsRef = collection(db, "users", uid, "projects");
    const q = query(projectsRef, orderBy("lastModified", "desc"));
    const snapshot = await getDocs(q);

    const owned: ResearchProject[] = snapshot.docs.map((docSnap) => {
      const data = docSnap.data();

      // Deserialize tables
      let tables = data.tables || [];
      if (tables.length > 0) {
        tables = tables.map((table: any) => {
          if (typeof table.rows === 'string') {
            try {
              return { ...table, rows: JSON.parse(table.rows) };
            } catch (e) {
              console.error('[Firebase] Failed to parse table rows:', e);
              return { ...table, rows: [] };
            }
          }
          return table;
        });
      }

      return {
        id: docSnap.id,
        name: data.name || '',
        description: data.description || '',
        createdAt: data.createdAt || Date.now(),
        lastModified: data.lastModified || Date.now(),
        researchSessions: data.researchSessions || [],
        suggestedTopics: data.suggestedTopics || [],
        seoSeedKeywords: data.seoSeedKeywords || [],
        tasks: data.tasks || [],
        notes: data.notes || [],
        aiInsights: data.aiInsights || [],
        knowledgeBase: data.knowledgeBase || [],
        projectConversations: data.projectConversations || [],
        draftResearchSessions: data.draftResearchSessions || [],
        uploadedFiles: data.uploadedFiles || [],
        ownerUid: data.ownerUid || uid,
        collaborators: data.collaborators || [],
        currentUserRole: 'owner',
        // Clear any persisted active research flags on hydration; the live
        // in-progress state is tracked separately in App and BlogCreator.
        activeResearchTopic: null,
        activeResearchStartedAt: null,
        stripeProducts: data.stripeProducts || [],
        emailTemplates: data.emailTemplates || [],
        theme: data.theme,
        pinnedAssetIds: data.pinnedAssetIds || [],
        worlds: data.worlds || [],
        tables,
      } as ResearchProject;
    });

    // 2) Shared projects where this user is a collaborator
    const sharedProjectsRef = collection(db, "users", uid, "sharedProjects");
    const sharedSnapshot = await getDocs(sharedProjectsRef);

    const shared: ResearchProject[] = [];

    for (const refDoc of sharedSnapshot.docs) {
      const refData = refDoc.data() as { projectId?: string; ownerUid?: string; role?: ProjectAccessRole };
      const projectId = refData.projectId;
      const ownerUid = refData.ownerUid;
      if (!projectId || !ownerUid) continue;

      const projectRef = doc(db, "users", ownerUid, "projects", projectId);
      const projectDoc = await getDoc(projectRef);
      if (!projectDoc.exists()) continue;

      const data = projectDoc.data();
      const role: ProjectAccessRole = refData.role && refData.role !== 'owner' ? refData.role : 'viewer';

      // Deserialize tables
      let tables = data.tables || [];
      if (tables.length > 0) {
        tables = tables.map((table: any) => {
          if (typeof table.rows === 'string') {
            try {
              return { ...table, rows: JSON.parse(table.rows) };
            } catch (e) {
              console.error('[Firebase] Failed to parse table rows:', e);
              return { ...table, rows: [] };
            }
          }
          return table;
        });
      }

      shared.push({
        id: projectDoc.id,
        name: data.name || '',
        description: data.description || '',
        createdAt: data.createdAt || Date.now(),
        lastModified: data.lastModified || Date.now(),
        researchSessions: data.researchSessions || [],
        suggestedTopics: data.suggestedTopics || [],
        seoSeedKeywords: data.seoSeedKeywords || [],
        tasks: data.tasks || [],
        notes: data.notes || [],
        aiInsights: data.aiInsights || [],
        knowledgeBase: data.knowledgeBase || [],
        projectConversations: data.projectConversations || [],
        draftResearchSessions: data.draftResearchSessions || [],
        uploadedFiles: data.uploadedFiles || [],
        stripeProducts: data.stripeProducts || [], // Add Stripe products
        ownerUid: data.ownerUid || ownerUid,
        collaborators: data.collaborators || [],
        currentUserRole: role,
        // Clear any persisted active research flags on hydration; the live
        // in-progress state is tracked separately in App and BlogCreator.
        activeResearchTopic: null,
        activeResearchStartedAt: null,
        emailTemplates: data.emailTemplates || [], // Add emailTemplates to shared projects
        // Use the local viewer's theme preference from the shared ref if available,
        // otherwise fall back to the project's theme (or null)
        theme: (refData as any).theme || data.theme,
        pinnedAssetIds: data.pinnedAssetIds || [],
        worlds: data.worlds || [],
        tables,
      } as ResearchProject);
    }

    const mergedById = new Map<string, ResearchProject>();

    const roleRank = (p: ResearchProject): number => {
      if (p.currentUserRole === 'owner') return 3;
      if (p.currentUserRole === 'editor') return 2;
      if (p.currentUserRole === 'viewer') return 1;
      return 0;
    };

    const consider = (project: ResearchProject) => {
      const existing = mergedById.get(project.id);
      if (!existing) {
        mergedById.set(project.id, project);
        return;
      }

      const existingRank = roleRank(existing);
      const candidateRank = roleRank(project);

      if (candidateRank > existingRank) {
        mergedById.set(project.id, project);
      } else if (candidateRank === existingRank && project.lastModified > existing.lastModified) {
        mergedById.set(project.id, project);
      }
    };

    owned.forEach(consider);
    shared.forEach(consider);

    const all = Array.from(mergedById.values());
    all.sort((a, b) => b.lastModified - a.lastModified);
    return all;
  } catch (error) {
    console.error("Error getting research projects:", error);
    return [];
  }
};

export const getResearchProjectFromFirestore = async (
  uid: string,
  projectId: string,
  loadFullSessions: boolean = false
): Promise<ResearchProject | null> => {
  console.log("[Firebase] getResearchProjectFromFirestore called:", { uid, projectId, loadFullSessions });

  try {
    const projectRef = doc(db, "users", uid, "projects", projectId);
    const projectDoc = await getDoc(projectRef);

    if (projectDoc.exists()) {
      const data = projectDoc.data();
      console.log("[Firebase] Project found in Firestore. Session references count:", data.researchSessions?.length || 0);

      let researchSessions = data.researchSessions || [];

      // Optionally load full session data from subcollection
      if (loadFullSessions && researchSessions.length > 0) {
        console.log("[Firebase] Loading full sessions from subcollection...");
        const sessionsCollectionRef = collection(db, "users", uid, "projects", projectId, "sessions");
        console.log("[Firebase] Subcollection path:", `users/${uid}/projects/${projectId}/sessions`);
        const sessionsSnapshot = await getDocs(sessionsCollectionRef);

        console.log("[Firebase] Subcollection query returned", sessionsSnapshot.size, "documents");

        const fullSessions: SavedResearch[] = [];

        // Need to process sessions with potential async chunk loading
        for (const sessionDoc of sessionsSnapshot.docs) {
          console.log("[Firebase] Found session in subcollection:", sessionDoc.id);
          const sessionData = sessionDoc.data();

          // Parse the stringified researchReport back to an object
          let parsedReport = null;

          // Check if report is chunked and needs reassembly
          if (sessionData.researchReportChunked && sessionData.researchReportChunkCount > 0) {
            console.log("[Firebase] Session has chunked report, reassembling", sessionData.researchReportChunkCount, "chunks");
            try {
              const chunksCollectionRef = collection(db, "users", uid, "projects", projectId, "sessions", sessionDoc.id, "chunks");
              const chunksSnapshot = await getDocs(chunksCollectionRef);

              // Sort chunks by index and reassemble
              const chunkData: { index: number; data: string }[] = [];
              chunksSnapshot.forEach((chunkDoc) => {
                const chunk = chunkDoc.data();
                chunkData.push({ index: chunk.index, data: chunk.data });
              });
              chunkData.sort((a, b) => a.index - b.index);

              const fullReportString = chunkData.map(c => c.data).join('');
              parsedReport = JSON.parse(fullReportString);
              console.log("[Firebase] Successfully reassembled chunked report for session:", sessionDoc.id);
            } catch (e) {
              console.error("[Firebase] Failed to reassemble chunked report:", e);
            }
          } else if (sessionData.researchReport) {
            if (typeof sessionData.researchReport === 'string') {
              // New format: entire researchReport is stringified
              try {
                parsedReport = JSON.parse(sessionData.researchReport);
                console.log("[Firebase] Parsed stringified researchReport for session:", sessionDoc.id);
              } catch (e) {
                console.error("[Firebase] Failed to parse researchReport string:", e);
              }
            } else {
              // Old format: researchReport is an object, but dynamicSections.content might be stringified
              parsedReport = sessionData.researchReport;
              if (parsedReport.dynamicSections) {
                parsedReport.dynamicSections = parsedReport.dynamicSections.map((section: any) => {
                  if (typeof section.content === 'string') {
                    try {
                      return {
                        ...section,
                        content: JSON.parse(section.content)
                      };
                    } catch (e) {
                      console.error("[Firebase] Failed to parse dynamicSection content:", e);
                      return section;
                    }
                  }
                  return section;
                });
              }
            }
          }

          const fullSession: SavedResearch = {
            id: sessionData.id,
            timestamp: sessionData.timestamp,
            lastModified: sessionData.lastModified,
            topic: sessionData.topic,
            researchReport: parsedReport,
            websiteVersions: sessionData.websiteVersions || [],
            noteMapState: sessionData.noteMapState || [],
            uploadedFiles: sessionData.uploadedFiles || [],
            conversations: sessionData.conversations || [],
            aiThinking: sessionData.aiThinking || [],
            assetCaptions: sessionData.assetCaptions || {}
          };

          fullSessions.push(fullSession);
        }


        console.log("[Firebase] Loaded", fullSessions.length, "full sessions from subcollection");

        // Merge full sessions with references - use full data where available, keep references for missing ones
        if (fullSessions.length > 0) {
          const fullSessionIds = new Set(fullSessions.map(s => s.id));

          // Keep references that don't have full data in subcollection
          const missingFromSubcollection = researchSessions.filter(ref => !fullSessionIds.has(ref.id));
          if (missingFromSubcollection.length > 0) {
            console.log("[Firebase] Sessions in references but not in subcollection:", missingFromSubcollection.map(s => s.id));
          }

          // Combine: full sessions first, then any missing references
          researchSessions = [...fullSessions, ...missingFromSubcollection];
        } else {
          console.warn("[Firebase] No sessions found in subcollection, keeping references only");
        }
      }

      if (researchSessions && researchSessions.length > 0) {
        const bySessionId = new Map<string, SavedResearch>();
        for (const session of researchSessions) {
          if (!session || !session.id) continue;
          if (!bySessionId.has(session.id)) {
            bySessionId.set(session.id, session as SavedResearch);
          }
        }
        researchSessions = Array.from(bySessionId.values());

        // Sort by timestamp (newest first)
        researchSessions.sort((a, b) => b.timestamp - a.timestamp);
      }

      // Deserialize tables - convert JSON-stringified rows back to arrays
      let tables = data.tables || [];
      if (tables.length > 0) {
        tables = tables.map((table: any) => {
          // If rows is a string, parse it back to an array
          if (typeof table.rows === 'string') {
            try {
              return {
                ...table,
                rows: JSON.parse(table.rows)
              };
            } catch (e) {
              console.error('[Firebase] Failed to parse table rows:', e);
              return {
                ...table,
                rows: []
              };
            }
          }
          // Already an array (backward compatibility)
          return table;
        });
      }

      const project = {
        id: projectDoc.id,
        name: data.name || '',
        description: data.description || '',
        createdAt: data.createdAt || Date.now(),
        lastModified: data.lastModified || Date.now(),
        researchSessions,
        suggestedTopics: data.suggestedTopics || [],
        seoSeedKeywords: data.seoSeedKeywords || [],
        tasks: data.tasks || [],
        notes: data.notes || [],
        aiInsights: data.aiInsights || [],
        knowledgeBase: data.knowledgeBase || [],
        uploadedFiles: data.uploadedFiles || [],
        projectConversations: data.projectConversations || [],
        draftResearchSessions: data.draftResearchSessions || [],
        newsArticles: data.newsArticles || [],
        newsLastFetchedAt: data.newsLastFetchedAt || null,
        stripeProducts: data.stripeProducts || [], // Add Stripe products
        ownerUid: data.ownerUid || uid,
        collaborators: data.collaborators || [],
        currentUserRole: 'owner',
        // Clear any persisted active research flags on hydration; the live
        // in-progress state is tracked separately in App and BlogCreator.
        emailTemplates: data.emailTemplates || [], // Add emailTemplates to shared projects
        theme: data.theme,
        pinnedAssetIds: data.pinnedAssetIds || [],
        worlds: data.worlds || [],
        tables, // Add deserialized tables
      } as ResearchProject;

      return project;
    }
    console.log("[Firebase] Project document does not exist in Firestore");
    return null;
  } catch (error) {
    console.error("[Firebase] Error getting research project:", error);
    return null;
  }
};

export const updateResearchProjectInFirestore = async (
  uid: string,
  projectId: string,
  updates: Partial<ResearchProject>
): Promise<void> => {
  try {
    const projectRef = doc(db, "users", uid, "projects", projectId);
    const sanitizedUpdates = sanitizeForFirestore({
      ...updates,
      lastModified: Date.now()
    });
    await updateDoc(projectRef, sanitizedUpdates);
    console.log("Research project updated in Firestore:", projectId);
  } catch (error) {
    console.error("Error updating research project:", error);
    throw error;
  }
};

export const deleteResearchProjectFromFirestore = async (uid: string, projectId: string): Promise<void> => {
  try {
    const projectRef = doc(db, "users", uid, "projects", projectId);
    await deleteDoc(projectRef);
    console.log("Research project deleted in Firestore:", projectId);
  } catch (error) {
    console.error("Error deleting research project:", error);
    throw error;
  }
};

// ========== PUBLIC SHARED REPORTS ==========

export type SharedResearchReport = {
  shareId: string;
  ownerUid: string;
  projectId: string;
  sessionId: string;
  topic: string;
  reportJson: string;
  isPublic: true;
  createdAt: any;
  updatedAt: any;
};

export const createSharedResearchReportInFirestore = async (
  uid: string,
  projectId: string,
  sessionId: string,
  report: ResearchReport,
): Promise<string> => {
  const shareId =
    typeof crypto !== 'undefined' && (crypto as any).randomUUID
      ? (crypto as any).randomUUID()
      : `share-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const refDoc = doc(db, 'sharedReports', shareId);
  const payload: SharedResearchReport = {
    shareId,
    ownerUid: uid,
    projectId,
    sessionId,
    topic: report?.topic || 'Untitled',
    reportJson: JSON.stringify(report || {}),
    isPublic: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await setDoc(refDoc, sanitizeForFirestore(payload), { merge: true });
  return shareId;
};

export const getSharedResearchReportFromFirestore = async (
  shareId: string,
): Promise<{ report: ResearchReport; meta: Omit<SharedResearchReport, 'reportJson'> } | null> => {
  try {
    const refDoc = doc(db, 'sharedReports', shareId);
    const snap = await getDoc(refDoc);
    if (!snap.exists()) return null;

    const data = snap.data() as Partial<SharedResearchReport>;
    if (!data?.isPublic) return null;
    if (!data?.reportJson) return null;

    let report: ResearchReport | null = null;
    try {
      report = JSON.parse(String(data.reportJson)) as ResearchReport;
    } catch (e) {
      console.error('[Firebase] Failed to parse shared report JSON', e);
      return null;
    }

    const { reportJson: _ignored, ...meta } = data as any;
    return { report, meta };
  } catch (error) {
    console.error('Error getting shared research report:', error);
    return null;
  }
};

// ========== COLLABORATION HELPERS ==========

export const upsertSharedProjectRef = async (
  collaboratorUid: string,
  ownerUid: string,
  projectId: string,
  role: ProjectAccessRole
): Promise<void> => {
  try {
    const ref = doc(db, "users", collaboratorUid, "sharedProjects", projectId);
    await setDoc(
      ref,
      {
        projectId,
        ownerUid,
        role: role === 'owner' ? 'editor' : role,
        addedAt: serverTimestamp(),
      },
      { merge: true }
    );
    console.log("Shared project ref upserted:", { collaboratorUid, ownerUid, projectId, role });
  } catch (error) {
    console.error("Error upserting shared project ref:", error);
    throw error;
  }
};

export const removeSharedProjectRef = async (
  collaboratorUid: string,
  projectId: string
): Promise<void> => {
  try {
    const ref = doc(db, "users", collaboratorUid, "sharedProjects", projectId);
    await deleteDoc(ref);
    console.log("Shared project ref removed:", { collaboratorUid, projectId });
  } catch (error) {
    console.error("Error removing shared project ref:", error);
    throw error;
  }
};

export const addResearchSessionToProject = async (
  uid: string,
  projectId: string,
  session: SavedResearch
): Promise<void> => {
  console.log("[Firebase] addResearchSessionToProject called:", { uid, projectId, sessionId: session.id, topic: session.topic });

  try {
    const projectRef = doc(db, "users", uid, "projects", projectId);
    console.log("[Firebase] Fetching project document from path:", `users/${uid}/projects/${projectId}`);
    const projectDoc = await getDoc(projectRef);

    // STEP 1: Store the FULL research session as a separate document in a subcollection
    // This avoids the "invalid nested entity" error by not nesting it in an array
    const sessionRef = doc(db, "users", uid, "projects", projectId, "sessions", session.id);

    // Stringify the entire researchReport to avoid ALL nested entity issues
    // Firestore has strict limits on nested objects/arrays - stringifying is the safest approach
    let cleanedResearchReport: string | null = null;
    if (session.researchReport) {
      try {
        cleanedResearchReport = JSON.stringify(session.researchReport);
        console.log("[Firebase] Stringified researchReport. Length:", cleanedResearchReport.length);
      } catch (e) {
        console.error("[Firebase] Failed to stringify researchReport:", e);
        // Fallback: store minimal data
        cleanedResearchReport = JSON.stringify({
          topic: session.researchReport.topic || '',
          tldr: session.researchReport.tldr || '',
          summary: session.researchReport.summary || ''
        });
      }
    }

    // Firestore has a ~1MB document limit. If report is too large, chunk it.
    const MAX_CHUNK_SIZE = 900000; // 900KB to leave room for other fields
    let reportChunks: string[] | null = null;
    let useChunking = false;

    if (cleanedResearchReport && cleanedResearchReport.length > MAX_CHUNK_SIZE) {
      console.log("[Firebase] Report exceeds 900KB, chunking into parts");
      useChunking = true;
      reportChunks = [];
      for (let i = 0; i < cleanedResearchReport.length; i += MAX_CHUNK_SIZE) {
        reportChunks.push(cleanedResearchReport.slice(i, i + MAX_CHUNK_SIZE));
      }
      console.log(`[Firebase] Split report into ${reportChunks.length} chunks`);
    }

    // Firestore does not allow undefined field values. Derive a safe topic string
    // from the session or its researchReport, and fall back to a generic label.
    const safeTopic: string =
      (session.topic && typeof session.topic === 'string' ? session.topic : '') ||
      (session.researchReport && typeof (session.researchReport as any).topic === 'string'
        ? (session.researchReport as any).topic
        : '') ||
      'Untitled Session';

    const fullSessionData = {
      id: session.id,
      timestamp: session.timestamp || Date.now(),
      lastModified: session.lastModified || Date.now(),
      topic: safeTopic,
      // If chunked, store null here and reference chunks; otherwise store the full report
      researchReport: useChunking ? null : cleanedResearchReport,
      researchReportChunked: useChunking,
      researchReportChunkCount: reportChunks ? reportChunks.length : 0,
      // Preserve any existing nested arrays so duplicated projects and
      // reloaded sessions keep their websites, uploads, and transcripts.
      websiteVersions: session.websiteVersions || [],
      noteMapState: session.noteMapState || [],
      uploadedFiles: session.uploadedFiles || [],
      conversations: session.conversations || [],
      aiThinking: session.aiThinking || [],
      assetCaptions: session.assetCaptions || []
    };

    console.log("[Firebase] Storing session in subcollection. Size:", JSON.stringify(fullSessionData).length, "chars, chunked:", useChunking);
    await setDoc(sessionRef, fullSessionData);
    console.log("[Firebase] ✅ Session stored in subcollection:", session.id);

    // If chunked, store each chunk as a separate document
    if (useChunking && reportChunks) {
      for (let i = 0; i < reportChunks.length; i++) {
        const chunkRef = doc(db, "users", uid, "projects", projectId, "sessions", session.id, "chunks", `chunk_${i}`);
        await setDoc(chunkRef, {
          index: i,
          data: reportChunks[i],
          totalChunks: reportChunks.length
        });
        console.log(`[Firebase] ✅ Stored chunk ${i + 1}/${reportChunks.length}`);
      }
    }


    // STEP 2: Store only a minimal reference in the project's researchSessions array
    const sessionReference = {
      id: session.id,
      timestamp: session.timestamp || Date.now(),
      lastModified: session.lastModified || Date.now(),
      topic: safeTopic,
      // Store just enough to display in lists
      tldr: session.researchReport?.tldr?.substring(0, 500) || '',
      summary: session.researchReport?.summary?.substring(0, 1000) || ''
    };

    if (!projectDoc.exists()) {
      // Project doesn't exist in Firestore yet - create it first
      console.warn("Project not found in Firestore, creating it first:", projectId);

      const newProjectData = sanitizeForFirestore({
        id: projectId,
        name: safeTopic || 'Untitled Project',
        description: '',
        createdAt: Date.now(),
        lastModified: Date.now(),
        researchSessions: [sessionReference],
        suggestedTopics: [],
        tasks: [],
        notes: [],
        knowledgeBase: [],
        aiInsights: []
      });

      await setDoc(projectRef, newProjectData);
      console.log("[Firebase] ✅ Created NEW project with session reference:", projectId);
      return;
    }

    // STEP 3: Add the reference to the project's researchSessions array
    const data = projectDoc.data();
    const sessions = data.researchSessions || [];

    sessions.unshift(sessionReference);

    console.log("[Firebase] Updating project with session reference. Total sessions:", sessions.length);
    await updateDoc(projectRef, {
      researchSessions: sessions,
      lastModified: Date.now()
    });
    console.log("[Firebase] ✅ Session reference added to project. Full data in subcollection.");
  } catch (error) {
    console.error("[Firebase] ❌ Error adding research session:", error);
    throw error;
  }
};

export const updateResearchSessionInProject = async (
  uid: string,
  projectId: string,
  sessionId: string,
  updates: Partial<SavedResearch>
): Promise<void> => {
  try {
    const projectRef = doc(db, "users", uid, "projects", projectId);
    const projectDoc = await getDoc(projectRef);

    if (projectDoc.exists()) {
      const data = projectDoc.data();
      const sessions = data.researchSessions || [];
      const sessionIndex = sessions.findIndex((s: SavedResearch) => s.id === sessionId);

      if (sessionIndex !== -1) {
        // Sanitize the incoming updates, but avoid writing the FULL researchReport
        // (which may contain nested arrays like table rows) into the top-level
        // project document. The full report is stored in the sessions
        // subcollection as a JSON string instead.
        const sanitizedUpdates = sanitizeForFirestore(updates);

        // Strip out researchReport from the lightweight reference stored on the
        // project document to avoid nested array validation errors.
        const { researchReport: _ignoredReport, ...restUpdates } = sanitizedUpdates as any;

        // Also strip any previously persisted researchReport from the existing
        // session reference on the project document so we never embed the
        // full report (with nested arrays) at this level.
        const { researchReport: _ignoredExistingReport, ...existingRef } =
          (sessions[sessionIndex] || {}) as any;

        const mergedReference: any = {
          ...existingRef,
          ...restUpdates,
          lastModified: Date.now(),
        };

        // If a full researchReport was provided, keep the summary fields
        // (tldr/summary) on the lightweight session reference for list views.
        if (updates.researchReport) {
          try {
            const report: any = updates.researchReport;
            if (typeof report.tldr === "string") {
              mergedReference.tldr = report.tldr.substring(0, 500);
            }
            if (typeof report.summary === "string") {
              mergedReference.summary = report.summary.substring(0, 1000);
            }
          } catch (e) {
            console.warn("[Firebase] Failed to derive reference fields from researchReport", e);
          }
        }

        sessions[sessionIndex] = sanitizeForFirestore(mergedReference);

        await updateDoc(projectRef, {
          researchSessions: sessions,
          lastModified: Date.now()
        });
        console.log("Research session updated:", sessionId);

        // Also update the full session document in the Firestore subcollection
        // so that reloading the project (with loadFullSessions=true) gets the
        // latest assets (blog, websites, etc.).
        const sessionRef = doc(db, "users", uid, "projects", projectId, "sessions", sessionId);
        const subcollectionUpdates: Record<string, any> = {
          lastModified: Date.now()
        };

        if (updates.researchReport) {
          try {
            subcollectionUpdates.researchReport = JSON.stringify(updates.researchReport);
          } catch (e) {
            console.error("[Firebase] Failed to stringify updated researchReport:", e);
            const report: any = updates.researchReport;
            subcollectionUpdates.researchReport = JSON.stringify({
              topic: report?.topic || "",
              tldr: report?.tldr || "",
              summary: report?.summary || ""
            });
          }
        }

        if (updates.websiteVersions) {
          subcollectionUpdates.websiteVersions = updates.websiteVersions;
        }

        if (updates.noteMapState) {
          subcollectionUpdates.noteMapState = updates.noteMapState;
        }

        if (updates.uploadedFiles) {
          subcollectionUpdates.uploadedFiles = updates.uploadedFiles;
        }

        if (Object.keys(subcollectionUpdates).length > 1) {
          try {
            await updateDoc(sessionRef, sanitizeForFirestore(subcollectionUpdates));
            console.log("[Firebase] Updated full session document with persisted assets:", sessionId);
          } catch (subError: any) {
            // If the full session document doesn't exist yet (older projects
            // created before we started storing sessions in a subcollection),
            // create/merge it instead of failing.
            if (subError?.code === 'not-found') {
              console.warn("[Firebase] Full session document missing, creating via setDoc:", sessionId);
              try {
                await setDoc(
                  sessionRef,
                  sanitizeForFirestore({
                    id: sessionId,
                    ...subcollectionUpdates,
                  }),
                  { merge: true },
                );
                console.log("[Firebase] Created full session document with persisted assets:", sessionId);
              } catch (setError) {
                console.error("[Firebase] Failed to create full session document via setDoc:", setError);
              }
            } else {
              console.error("[Firebase] Failed to update full session document:", subError);
            }
          }
        }
      }
    }
  } catch (error) {
    console.error("Error updating research session:", error);
    throw error;
  }
};

// Get full research session from subcollection
export const getResearchSessionFromFirestore = async (
  uid: string,
  projectId: string,
  sessionId: string
): Promise<SavedResearch | null> => {
  try {
    const sessionRef = doc(db, "users", uid, "projects", projectId, "sessions", sessionId);
    const sessionDoc = await getDoc(sessionRef);

    if (sessionDoc.exists()) {
      console.log("[Firebase] Retrieved full session from subcollection:", sessionId);
      return sessionDoc.data() as SavedResearch;
    }

    console.warn("[Firebase] Session not found in subcollection:", sessionId);
    return null;
  } catch (error) {
    console.error("[Firebase] Error retrieving session:", error);
    return null;
  }
};

export const deleteResearchSessionFromProject = async (
  uid: string,
  projectId: string,
  sessionId: string
): Promise<void> => {
  try {
    // Delete from subcollection
    const sessionRef = doc(db, "users", uid, "projects", projectId, "sessions", sessionId);
    await deleteDoc(sessionRef);
    console.log("[Firebase] Deleted session from subcollection:", sessionId);

    // Remove reference from project
    const projectRef = doc(db, "users", uid, "projects", projectId);
    const projectDoc = await getDoc(projectRef);

    if (projectDoc.exists()) {
      const data = projectDoc.data();
      const sessions = (data.researchSessions || []).filter((s: any) => s.id !== sessionId);

      await updateDoc(projectRef, {
        researchSessions: sessions,
        lastModified: Date.now()
      });
      console.log("[Firebase] Removed session reference from project:", sessionId);
    }
  } catch (error) {
    console.error("Error deleting research session:", error);
    throw error;
  }
};

// ========== TASKS MANAGEMENT ==========

export const updateProjectTasksInFirestore = async (
  uid: string,
  projectId: string,
  tasks: ProjectTask[]
): Promise<void> => {
  try {
    const projectRef = doc(db, "users", uid, "projects", projectId);
    const sanitizedTasks = sanitizeForFirestore(tasks);
    await updateDoc(projectRef, {
      tasks: sanitizedTasks,
      lastModified: Date.now()
    });
    console.log("Tasks updated in Firestore for project:", projectId);
  } catch (error) {
    console.error("Error updating tasks:", error);
    throw error;
  }
};

// ========== NOTES MANAGEMENT ==========

export const updateProjectNotesInFirestore = async (
  uid: string,
  projectId: string,
  notes: ProjectNote[]
): Promise<void> => {
  try {
    const projectRef = doc(db, "users", uid, "projects", projectId);
    const sanitizedNotes = sanitizeForFirestore(notes);
    await updateDoc(projectRef, {
      notes: sanitizedNotes,
      lastModified: Date.now()
    });
    console.log("Notes updated in Firestore for project:", projectId);
  } catch (error) {
    console.error("Error updating notes:", error);
    throw error;
  }
};

// ... (rest of the code remains the same)

export const uploadFileToStorage = async (
  uid: string,
  projectId: string,
  file: File,
  researchSessionId?: string
): Promise<KnowledgeBaseFile> => {
  const fileId = `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const storagePath = researchSessionId
    ? `users/${uid}/projects/${projectId}/research/${researchSessionId}/${fileId}_${file.name}`
    : `users/${uid}/projects/${projectId}/knowledge-base/${fileId}_${file.name}`;

  const storageRef = ref(storage, storagePath);

  try {
    await uploadBytes(storageRef, file);
    const url = await getDownloadURL(storageRef);

    const knowledgeFile: KnowledgeBaseFile = {
      id: fileId,
      name: file.name,
      type: file.type,
      size: file.size,
      url,
      storagePath,
      uploadedAt: Date.now(),
      researchSessionId
    };

    console.log("File uploaded to Storage:", storagePath);
    return knowledgeFile;
  } catch (error) {
    console.error("Error uploading file:", error);
    throw error;
  }
};

export const uploadProfileImageToStorage = async (
  uid: string,
  file: File
): Promise<string> => {
  const extension = file.name.split('.').pop();
  const storagePath = `users/${uid}/profile/avatar_${Date.now()}.${extension}`;
  const storageRef = ref(storage, storagePath);

  try {
    await uploadBytes(storageRef, file);
    const url = await getDownloadURL(storageRef);
    console.log("Profile image uploaded to Storage:", storagePath);
    return url;
  } catch (error) {
    console.error("Error uploading profile image:", error);
    throw error;
  }
};

export const deleteFileFromStorage = async (storagePath: string): Promise<void> => {
  try {
    const storageRef = ref(storage, storagePath);
    await deleteObject(storageRef);
    console.log("File deleted from Storage:", storagePath);
  } catch (error) {
    console.error("Error deleting file:", error);
    throw error;
  }
};

export const updateProjectKnowledgeBaseInFirestore = async (
  uid: string,
  projectId: string,
  knowledgeBase: KnowledgeBaseFile[]
): Promise<void> => {
  try {
    const projectRef = doc(db, "users", uid, "projects", projectId);
    await updateDoc(projectRef, {
      knowledgeBase: knowledgeBase,
      lastModified: Date.now()
    });
    console.log("Knowledge base updated in Firestore for project:", projectId);
  } catch (error) {
    console.error("Error updating knowledge base:", error);
    throw error;
  }
};

export const updateResearchFilesInFirestore = async (
  uid: string,
  projectId: string,
  researchId: string,
  uploadedFiles: KnowledgeBaseFile[]
): Promise<void> => {
  try {
    const projectRef = doc(db, "users", uid, "projects", projectId);
    const projectDoc = await getDoc(projectRef);

    if (projectDoc.exists()) {
      const data = projectDoc.data();
      const sessions = data.researchSessions || [];
      const updatedSessions = sessions.map((session: any) =>
        session.id === researchId
          ? { ...session, uploadedFiles, lastModified: Date.now() }
          : session
      );

      await updateDoc(projectRef, {
        researchSessions: updatedSessions,
        lastModified: Date.now()
      });
      console.log("Research files updated in Firestore:", researchId);
    }
  } catch (error) {
    console.error("Error updating research files:", error);
    throw error;
  }
};

export const updateSharedProjectThemeInFirestore = async (uid: string, projectId: string, theme: string | null): Promise<void> => {
  try {
    const sharedProjectsRef = collection(db, "users", uid, "sharedProjects");
    const q = query(sharedProjectsRef, where("projectId", "==", projectId));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      console.warn("[Firebase] No shared project reference found for", projectId);
      return;
    }

    const docRef = snapshot.docs[0].ref;
    await updateDoc(docRef, { theme });
    console.log("[Firebase] Updated shared project theme for user", uid);
  } catch (error) {
    console.error("Error updating shared project theme:", error);
    throw error;
  }
};

export const getSharedProjectTheme = async (uid: string, projectId: string): Promise<string | null> => {
  try {
    const sharedProjectsRef = collection(db, "users", uid, "sharedProjects");
    const q = query(sharedProjectsRef, where("projectId", "==", projectId));
    const snapshot = await getDocs(q);

    if (!snapshot.empty) {
      const data = snapshot.docs[0].data();
      return data.theme || null;
    }
    return null;
  } catch (error) {
    console.error("Error getting shared project theme:", error);
    return null;
  }
};
