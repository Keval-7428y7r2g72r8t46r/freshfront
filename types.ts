

export enum AppMode {
  BLOG_CREATOR = 'BLOG_CREATOR',
  IMAGE_STUDIO = 'IMAGE_STUDIO',
  MOTION_LAB = 'MOTION_LAB',
  INSPIRATION = 'INSPIRATION',
  NOTE_MAP = 'NOTE_MAP',
}

import { ThemeType } from './constants';

export type { ThemeType };

export type TabId = 'overview' | 'tasks' | 'seo' | 'notes' | 'assets' | 'data' | 'social' | 'email' | 'inspo' | 'live';

export interface AssetItem {
  id: string;
  type: 'header' | 'slide' | 'notemap' | 'blog' | 'website' | 'social' | 'video' | 'podcast' | 'book' | 'table' | 'leadform' | 'product' | 'doc' | 'world';
  url?: string;
  title: string;
  description?: string;
  data?: any;
  researchId: string;
  researchTopic: string;
  timestamp: number;
}

export interface UserProfile {
  displayName?: string;
  description?: string;
  photoURL?: string;
  email?: string;
  organizationId?: string | null;
  themePreference?: 'dark' | 'light' | 'system';
  stripeConnect?: StripeConnectAccount;
}

export interface GroundingChunk {
  web?: {
    uri?: string;
    title?: string;
  };
  maps?: {
    desktopUri?: string;
    sourceConfig?: {
      title?: string;
    };
  };
}

export interface SearchResult {
  text: string;
  sources: GroundingChunk[];
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  timestamp: number;
  audioTranscript?: string;
  thinking?: string;
  imageUrl?: string;
  audioUrl?: string;
}

export interface SessionConversation {
  id: string;
  sessionId: string;
  messages: ChatMessage[];
  mode: 'voice' | 'chat';
  startedAt: number;
  endedAt?: number;
}

export interface AIThinkingLog {
  id: string;
  timestamp: number;
  thought: string;
  context?: string;
  toolsUsed?: string[];
}

export interface AssetCaption {
  assetId: string;
  assetType: 'image' | 'file' | 'video';
  caption: string;
  aiGenerated: boolean;
  timestamp: number;
}

export interface BlogArticle {
  headline: string;
  content: string;
  imagePrompt: string;
  imageUrl?: string;
}

export interface ResearchReport {
  topic: string;
  category?: string;
  headerImagePrompt: string;
  headerImageUrl?: string;
  tldr: string;
  summary: string;
  expandedSummary?: string;
  narrationScript?: string;
  keyPoints: {
    title: string;
    details: string;
    priority: string;
  }[];
  slides?: Slide[];
  dynamicSections?: DynamicSection[];
  marketImplications: string;
  gameConcept?: {
    title: string;
    educationalGoal: string;
    type: 'quiz' | 'simulation' | 'puzzle';
    mechanic:
    | 'space_blaster'
    | 'asteroids'
    | 'tetris'
    | 'pacman'
    | 'platformer'
    | 'merge_2048'
    | 'tower_defense'
    | 'duolingo_quiz'
    | 'memory_match'
    | 'word_puzzle';
  };
  jobListings?: JobListing[];
  sources?: Source[];
  userNotes?: string;
  theme?: DualTheme;
  youtubeVideos?: YoutubeVideo[];
  videoAnalysis?: VideoAnalysis;
  socialCampaign?: SocialCampaign;
  blogPost?: BlogPost;
  videoPost?: VideoPost;
  funSection?: string; // HTML content
  topicWidget?: string;
  books?: BookAsset[];
  tables?: TableAsset[];

  wizaProspects?: WizaProspectsResult;
  wizaCompanies?: WizaCompaniesResult;
  userLocation?: { lat: number; lng: number };
}

export interface WizaProspectsResult {
  status?: {
    code?: number;
    message?: string;
  };
  data?: {
    total?: number;
    profiles?: any[];
  };
  error?: string;
  [key: string]: any;
}

export interface WizaCompaniesResult {
  status?: {
    code?: number;
    message?: string;
  };
  data?: any;
  error?: string;
  [key: string]: any;
}

export interface JobListing {
  id?: string;
  title: string;
  company: string;
  location: string;
  url: string;
  type: string;
  salary?: string;
  pubDate?: string;
}

export interface Slide {
  title: string;
  content: string[];
  imagePrompt?: string;
  imageUrl?: string;
  imageUrls?: string[]; // Fallback
}

export interface DynamicSection {
  title: string;
  type:
  | 'stats' | 'top_picks' | 'interactive_widget' | 'timeline' | 'comparison' | 'text' | 'table' | 'faq' | 'checklist' | 'quote' | 'radar_chart' | 'swot_analysis' | 'process_flow' | 'metric_card_grid' | 'tradingview_chart' | 'map_widget'
  | 'scenario_slider' | 'parameter_knobs' | 'venn_diagram' | 'sankey_flow' | 'bias_radar' | 'influence_network' | 'root_cause_tree' | 'sentiment_timeline' | 'insight_cards' | 'word_cloud' | 'iceberg_depth' | 'shield_meter' | 'confidence_gauge' | 'action_items' | 'eli5_toggle'
  | 'persona_grid' | 'funnel_breakdown' | 'channel_mix_board' | 'messaging_matrix' | 'competitor_battlecards' | 'experiment_backlog' | 'content_calendar' | 'pricing_tiers' | 'opportunity_grid' | 'gtm_playbook'
  | 'risk_matrix' | 'decision_tree' | 'stakeholder_map' | 'milestone_tracker' | 'resource_allocation' | 'heat_map' | 'bubble_chart' | 'before_after' | 'pros_cons_neutral' | 'feature_comparison' | 'rating_breakdown' | 'skill_tree' | 'dependency_graph' | 'cost_benefit' | 'impact_effort'
  | 'learning_path' | 'recipe_steps' | 'product_showcase' | 'poll_results' | 'org_chart' | 'mood_board' | 'event_agenda' | 'testimonials' | 'tips_grid' | 'numbered_list' | 'resource_links' | 'glossary' | 'trivia_facts' | 'highlight_box' | 'progress_tracker'
  | 'poetry_display' | 'music_player' | 'artwork_gallery' | 'book_shelf' | 'creative_showcase'
  | 'periodic_element' | 'discovery_timeline' | 'formula_display' | 'anatomy_explorer' | 'experiment_steps'
  | 'event_calendar' | 'venue_cards' | 'directions_guide' | 'local_spotlight'
  | 'flashcard_deck' | 'quiz_interactive' | 'concept_map' | 'study_schedule'
  | 'recipe_card' | 'workout_routine' | 'nutrition_breakdown' | 'habit_tracker'
  | 'company_profile' | 'executive_team' | 'product_lineup' | 'tech_stack'
  | 'destination_guide' | 'hotel_showcase' | 'travel_itinerary'
  | 'movie_cast' | 'game_roster' | 'historical_figure'
  | 'wildlife_encyclopedia' | 'plant_guide' | 'space_exploration'
  | 'fashion_lookbook' | 'architectural_style' | 'vehicle_showcase' | 'property_listing' | 'news_gallery'
  | 'entity_logo_wall' | 'key_people_gallery' | 'chart_image_gallery'
  | 'buying_guide' | 'streaming_guide' | 'gift_ideas' | 'diy_project' | 'pet_care' | 'parenting_tips' | 'hobby_starter' | 'budget_breakdown' | 'life_hack_cards' | 'review_summary' | 'podcast_playlist' | 'season_guide' | 'celebration_planner';
  content: any;
  icon?: string;
  imagePrompt?: string;
  imageUrl?: string;
}

export interface Source {
  title: string;
  uri: string;
  url?: string;
  snippet?: string;
}

export interface NoteNode {
  id: string;
  x: number;
  y: number;
  title: string;
  content: string;
  color?: string;
  width?: number;
  height?: number;
  parentId?: string;
  imageUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
  fileUrl?: string;
  fileName?: string;
  fileMime?: string;
  fileSize?: number;
  youtubeVideoId?: string;
  youtubeUrl?: string;
  youtubeThumbnailUrl?: string;
  youtubeAnalysis?: string;
  isGenerating?: boolean;
  type?: 'note' | 'text' | 'drawing' | 'shape';
  drawingPath?:
  | { x: number; y: number }[]
  | { shapeType: 'rectangle' | 'circle' | 'arrow' | 'line'; x1: number; y1: number; x2: number; y2: number };
  fontSize?: number;
  connections?: string[];
  rotation?: number;
  scale?: number;
}

export interface NoteTermDefinition {
  id: string;
  term: string;
  definition: string;
}

export type TaskStatus = 'todo' | 'in_progress' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high';

export interface ProjectTask {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  order: number;
  createdAt: number;
  lastModified: number;
  dueDate?: number;
  dueDateEnd?: number;
  googleCalendarEventId?: string;
  googleCalendarHtmlLink?: string;
  googleMeetLink?: string;
  aiGenerated?: boolean;
  sourceResearchId?: string;
  tags?: string[];
}

export interface ProjectNote {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  lastModified: number;
  color?: string;
  pinned?: boolean;
  aiGenerated?: boolean;
  aiSuggestions?: string[];
  tags?: string[];
  linkedResearchId?: string;
  termDefinitions?: NoteTermDefinition[];
}

export interface AIInsight {
  id: string;
  type: 'task_suggestion' | 'priority_recommendation' | 'note_enhancement' | 'summary';
  content: string;
  actionable?: boolean;
  sourceData?: any;
  createdAt: number;
}

export interface KnowledgeBaseFile {
  id: string;
  name: string;
  type: string;
  size: number;
  url: string;
  storagePath: string;
  uploadedAt: number;
  extractedText?: string;
  summary?: string;
  researchSessionId?: string;
  fileSearchDocumentName?: string;
  fileSearchIndexedAt?: number;
  fileSearchIndexError?: string;
}

export interface ResearchDraft {
  id: string;
  topic: string;
  createdAt: number;
}

export interface NewsArticle {
  source?: string | null;
  title: string;
  description?: string | null;
  url: string;
  urlToImage?: string | null;
  publishedAt?: string | null;
}

export type ProjectAccessRole = 'owner' | 'editor' | 'viewer';

export interface ProjectCollaborator {
  uid: string;
  email?: string;
  role: Exclude<ProjectAccessRole, 'owner'>;
  addedAt: number;
}

export interface ResearchProject {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  lastModified: number;
  researchSessions: SavedResearch[];
  projectNoteMapState?: NoteNode[];
  suggestedTopics?: string[];
  seoSeedKeywords?: string[];
  tasks?: ProjectTask[];
  notes?: ProjectNote[];
  aiInsights?: AIInsight[];
  knowledgeBase?: KnowledgeBaseFile[];
  uploadedFiles?: UploadedFile[];
  projectConversations?: SessionConversation[];
  draftResearchSessions?: ResearchDraft[];
  ownerUid?: string;
  collaborators?: ProjectCollaborator[];
  currentUserRole?: ProjectAccessRole;

  newsArticles?: NewsArticle[];
  newsLastFetchedAt?: number;

  youtubeVideos?: YoutubeVideo[];
  youtubeLastFetchedAt?: number;

  // Optional: track a currently running deep research job for this project
  activeResearchTopic?: string | null;
  activeResearchStartedAt?: number | null;
  activeResearchStatus?: 'in_progress' | 'completed' | 'failed';

  // Scheduled social media posts (for chat context)
  scheduledPosts?: ScheduledPost[];

  // SEO tab search results (for chat context)
  seoSearchResults?: SeoSearchResults;

  // Google integrations (for chat context)
  googleIntegrations?: GoogleIntegrations;

  // Lead forms and captured leads
  leadForms?: LeadFormAsset[];
  capturedLeads?: CapturedLead[];

  // Stripe Connect products (account info is at user level)
  stripeProducts?: StripeProduct[];

  // Email Templates
  emailTemplates?: EmailTemplate[];

  // Project-level tables and charts (no session required)
  tables?: TableAsset[];
  charts?: TableAsset[];
  worlds?: WorldAsset[];
  tabOrder?: string[];
  theme?: ThemeType;
  pinnedAssetIds?: string[];
}

// Email block content types
// Email block content types
export interface TextBlockContent {
  text: string;
}

export interface ImageBlockContent {
  src: string;
  alt: string; // Changed from optional to required to match EmailBuilder
  width: string; // Changed from optional to required to match EmailBuilder
  height?: string;
  link?: string;
}

export interface ButtonBlockContent {
  text: string;
  url: string;
  backgroundColor: string;
  textColor: string; // Changed from color to textColor
  align?: 'left' | 'center' | 'right';
  borderRadius: string; // Changed from optional to required
}

export interface DividerBlockContent {
  color: string;
  thickness: string; // Changed from height to thickness
}

export interface SpacerBlockContent {
  height: string;
}

export interface SocialBlockContent {
  platforms: {
    name: string;
    url: string;
    slug?: string;
    enabled: boolean;
  }[]; // Changed from networks array to match EmailBuilder
}

export interface ProductBlockContent {
  productId?: string;
  image?: string;
  title: string;
  price: string;
  description: string;
  buttonText: string;
  buttonUrl: string;
  buttonColor: string;
  buttonTextColor: string;
  buttonBorderRadius?: string;
}

export interface ColumnsBlockContent {
  columns: number;
  children: { blocks: EmailBlock[] }[];
}

export type BlockContent =
  | TextBlockContent
  | ImageBlockContent
  | ButtonBlockContent
  | DividerBlockContent
  | SpacerBlockContent
  | SocialBlockContent
  | ColumnsBlockContent
  | ProductBlockContent;

export interface BlockStyles {
  padding?: string;
  backgroundColor?: string;
  fontFamily?: string;
  fontSize?: string;
  color?: string;
  textAlign?: 'left' | 'center' | 'right';
  border?: string;
  borderRadius?: string;
  lineHeight?: string; // Added
  fontWeight?: string; // Added
}

export interface EmailBlock {
  id: string;
  type: 'text' | 'image' | 'button' | 'divider' | 'spacer' | 'social' | 'columns' | 'header' | 'footer' | 'product';
  content: BlockContent;
  styles: BlockStyles;
}

export interface EmailTemplate {
  id: string;
  name: string;
  // Simple Template Fields
  subject?: string;
  body?: string;
  // Rich Template Fields
  blocks?: EmailBlock[];
  createdAt?: number;
  updatedAt?: number;
}

export interface StripeConnectAccount {
  accountId: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  createdAt: number;
}

export interface StripeProduct {
  id: string;
  name: string;
  description?: string;
  active: boolean;
  metadata?: Record<string, string>;
  priceId?: string;
  unitAmount: number;
  currency: string;
  createdAt: number;
  images?: string[];
  paymentLinkUrl?: string;
  customFields?: Array<{
    key: string;
    label: string;
    type: 'text' | 'numeric';
  }>;
  quantityOptions?: {
    enabled: boolean;
    minimum: number;
    maximum: number;
  };
}

export interface ScheduledPost {
  id: string;
  scheduledAt: number;
  platforms: string[];
  textContent: string;
  status: string;
}

// SEO tab search results for chat context
export interface SeoSearchResults {
  // SEO keyword analysis
  seoAnalysis?: {
    keyword: string;
    location: string;
    data: any;
    advice: string | null;
  };
  // Instagram hashtag research
  igHashtagResearch?: {
    query: string;
    hashtagId: string | null;
    topMedia: any[];
    recentMedia: any[];
  };
  // Instagram business discovery
  igBusinessDiscovery?: {
    username: string;
    result: any;
  };
  // X (Twitter) search
  xSearch?: {
    mode: 'tweets' | 'users';
    query: string;
    results: any;
  };
  // Facebook/Instagram ad targeting search
  adTargetingSearch?: {
    type: string;
    query: string;
    results: any[];
  };
}

// Google integrations data for chat context
export interface GoogleIntegrations {
  // Google Drive imported files
  driveFiles?: {
    id: string;
    name: string;
    mimeType: string;
    size?: string;
    modifiedTime?: string;
  }[];
  // Google Calendar events
  calendarEvents?: {
    id?: string;
    summary?: string;
    description?: string;
    start?: { dateTime?: string; date?: string };
    end?: { dateTime?: string; date?: string };
    location?: string;
    htmlLink?: string;
  }[];
  // Synced Google Docs content (for AI context)
  syncedDocs?: {
    documentId: string;
    title: string;
    text: string;
    lastSyncedAt: number;
  }[];
  // Synced Google Sheets content (for AI context)
  syncedSheets?: {
    spreadsheetId: string;
    sheetTitle: string;
    title: string;
    columns: string[];
    rows: string[][];
    lastSyncedAt: number;
  }[];
}

export interface SavedResearch {
  id: string;
  timestamp: number;
  lastModified: number;
  topic: string;
  researchReport: ResearchReport;
  websiteVersions: SavedWebsiteVersion[];
  noteMapState?: NoteNode[];
  assets?: AssetItem[]; // Added assets to SavedResearch
  uploadedFiles?: KnowledgeBaseFile[];
  conversations?: SessionConversation[];
  aiThinking?: AIThinkingLog[];
  assetCaptions?: AssetCaption[];
  shareId?: string;
  isStale?: boolean;
}

export interface SavedProject {
  id: string;
  timestamp: number;
  lastModified: number;
  topic: string;
  researchReport: ResearchReport;
  websiteVersions: SavedWebsiteVersion[];
  noteMapState?: NoteNode[];
}

export interface SavedWebsiteVersion {
  id: string;
  timestamp: number;
  html: string;
  description: string; // Keep this one
  publicUrl?: string; // Keep this one
  shareFileId?: string;
  slug?: string;
}

export interface ThemePalette {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
}

export interface DualTheme {
  light: ThemePalette;
  dark: ThemePalette;
}

export interface YoutubeVideo {
  id: string;
  title: string;
  thumbnail: string;
  channel: string;
  views: string;
  duration: string;
  publishedAt?: string;
  description?: string;

}

export interface VideoAnalysis {
  videoId: string;
  title: string;
  analysis: string;
}

export interface SocialPost {
  platform: 'Instagram' | 'LinkedIn' | 'Twitter';
  caption: string;
  hashtags: string[];
  imagePrompt: string;
  imageUrl?: string;
}

export interface SocialCampaign {
  posts: SocialPost[];
}

export interface BlogPost {
  title: string;
  subtitle: string;
  content: string;
  imagePrompt: string;
  imageUrl?: string;
}

export interface VideoPost {
  videoUrl: string;
  caption: string;
  hashtags: string;
  provider?: 'sora' | 'creatomate' | 'veo';
}

export interface BookPage {
  id: string;
  pageNumber: number;
  imageUrl: string;
  prompt: string;
  text?: string;
}

export interface BookAsset {
  id: string;
  title: string;
  description?: string;
  pages: BookPage[];
  createdAt: number;
  pdfUrl?: string;
  pdfFileId?: string;
  html?: string;
  isInteractive?: boolean;
}

export interface TableAsset {
  id: string;
  title: string;
  description?: string;
  columns: string[];
  rows: string[][];
  createdAt: number;
  googleSpreadsheetId?: string;
  googleSheetTitle?: string;
}

export interface WorldAsset {
  id: string;
  prompt: string;
  previewUrl: string;
  createdAt: number;
  status?: 'generating' | 'complete' | 'failed';
  operationId?: string;
  data?: any;
}

// Lead form field configuration
export interface LeadFormField {
  id: string;
  name: string;           // e.g., 'fullName', 'email', 'phone'
  label: string;          // Display label e.g., 'Full Name'
  type: 'text' | 'email' | 'phone' | 'textarea' | 'select' | 'checkbox';
  required: boolean;
  placeholder?: string;
  options?: string[];     // For select fields
}

// Lead form asset (stored in project)
export interface LeadFormAsset {
  id: string;
  title: string;
  description?: string;
  prompt: string;         // User's prompt for website generation
  fields: LeadFormField[];
  html: string;           // Generated form website HTML
  publicUrl: string;      // Hosted URL
  slug: string;           // URL slug
  createdAt: number;
  projectId: string;
  leadCount?: number;
  lastLeadAt?: number;
}

// Captured lead entry
export interface CapturedLead {
  id: string;
  formId: string;
  formTitle: string;
  projectId: string;
  data: Record<string, string>; // Field values keyed by field name
  submittedAt: number;
  ipAddress?: string;
  userAgent?: string;
}

export interface UploadedFile {
  id?: string;
  name: string;
  uri: string;
  mimeType: string;
  sizeBytes: number;
  displayName: string;
  uploadedAt: number;
  expiresAt?: number;
  summary?: string; // AI-generated summary of the file content
  url?: string; // Public download/display URL (Firebase Storage)
}


