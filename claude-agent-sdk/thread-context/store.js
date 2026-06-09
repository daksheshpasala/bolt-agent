/**
 * @typedef {Object} StoreEntry
 * @property {string} sessionId
 * @property {number} timestamp
 */

/**
 * @typedef {Object} IssueRecord
 * @property {string} category
 * @property {number} timestamp
 * @property {string} [title]
 */

/**
 * @typedef {Object} UserProfile
 * @property {string} userId
 * @property {IssueRecord[]} issueHistory
 * @property {string[]} messageSnippets
 * @property {number} totalInteractions
 * @property {number} lastSeen
 */

/**
 * In-memory session ID store with TTL-based cleanup + user-level insights.
 */
export class SessionStore {
  /**
   * @param {number} [ttlSeconds=86400]
   * @param {number} [maxEntries=1000]
   */
  constructor(ttlSeconds = 86400, maxEntries = 1000) {
    /** @type {Map<string, StoreEntry>} */
    this._store = new Map();
    /** @type {Map<string, UserProfile>} */
    this._userProfiles = new Map();
    /** @private @type {number} */
    this._ttlSeconds = ttlSeconds;
    /** @private @type {number} */
    this._maxEntries = maxEntries;
  }

  /**
   * @param {string} channelId
   * @param {string} threadTs
   * @returns {string | null}
   */
  getSession(channelId, threadTs) {
    const key = `${channelId}:${threadTs}`;
    const entry = this._store.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this._ttlSeconds * 1000) {
      this._store.delete(key);
      return null;
    }
    return entry.sessionId;
  }

  /**
   * @param {string} channelId
   * @param {string} threadTs
   * @param {string} sessionId
   * @returns {void}
   */
  setSession(channelId, threadTs, sessionId) {
    const key = `${channelId}:${threadTs}`;
    this._store.set(key, {
      sessionId,
      timestamp: Date.now(),
    });
    this._cleanup();
  }

  /**
   * Record an issue for a user (track issue types and patterns).
   * @param {string} userId
   * @param {string} category
   * @param {string} [title]
   * @returns {void}
   */
  recordIssue(userId, category, title = undefined) {
    let profile = this._userProfiles.get(userId);
    if (!profile) {
      profile = {
        userId,
        issueHistory: [],
        messageSnippets: [],
        totalInteractions: 0,
        lastSeen: Date.now(),
      };
      this._userProfiles.set(userId, profile);
    }
    profile.issueHistory.push({
      category,
      timestamp: Date.now(),
      title,
    });
    profile.totalInteractions += 1;
    profile.lastSeen = Date.now();
  }

  /**
   * Record a message snippet for a user (used for tech level + style inference).
   * @param {string} userId
   * @param {string} messageText
   * @returns {void}
   */
  addMessageSnippet(userId, messageText) {
    let profile = this._userProfiles.get(userId);
    if (!profile) {
      profile = {
        userId,
        issueHistory: [],
        messageSnippets: [],
        totalInteractions: 0,
        lastSeen: Date.now(),
      };
      this._userProfiles.set(userId, profile);
    }
    profile.messageSnippets.push(messageText);
    profile.lastSeen = Date.now();
    // Keep last 10 snippets
    if (profile.messageSnippets.length > 10) {
      profile.messageSnippets.shift();
    }
  }

  /**
   * Get user profile with insights.
   * @param {string} userId
   * @returns {UserProfile | null}
   */
  getUserProfile(userId) {
    return this._userProfiles.get(userId) || null;
  }

  /**
   * Get most common issue types for a user.
   * @param {string} userId
   * @returns {Array<{category: string, count: number}>}
   */
  getCommonIssueTypes(userId) {
    const profile = this._userProfiles.get(userId);
    if (!profile || profile.issueHistory.length === 0) return [];

    /** @type {{[category: string]: number}} */
    const counts = {};
    for (const issue of profile.issueHistory) {
      counts[issue.category] = (counts[issue.category] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Detect if user is asking about a similar topic (repeat detection).
   * @param {string} userId
   * @param {string} newMessage
   * @returns {string | null}
   */
  detectRepeatQuestion(userId, newMessage) {
    const profile = this._userProfiles.get(userId);
    if (!profile || profile.messageSnippets.length === 0) return null;

    const keywords = this._extractKeywords(newMessage);
    for (const snippet of profile.messageSnippets) {
      const snippetKeywords = this._extractKeywords(snippet);
      const overlap = keywords.filter((k) => snippetKeywords.includes(k)).length;
      if (overlap >= 2) {
        // At least 2 keywords match
        return snippet;
      }
    }
    return null;
  }

  /**
   * Infer user's technical level based on message complexity.
   * @param {string} userId
   * @returns {'beginner' | 'intermediate' | 'advanced'}
   */
  inferTechnicalLevel(userId) {
    const profile = this._userProfiles.get(userId);
    if (!profile || profile.messageSnippets.length === 0) return 'intermediate';

    // Simple heuristics
    const allText = profile.messageSnippets.join(' ').toLowerCase();

    // Advanced markers
    const advancedKeywords = [
      'kernel',
      'registry',
      'firewall',
      'vpn',
      'api',
      'cli',
      'ssh',
      'permission',
      'config',
      'driver',
      'port',
      'dns',
    ];
    const advancedCount = advancedKeywords.filter((k) => allText.includes(k)).length;

    // Beginner markers
    const beginnerMarkers = [
      "i don't know",
      'how do i',
      'what is',
      'how do you',
      'confused',
      'help',
    ];
    const beginnerCount = beginnerMarkers.filter((k) => allText.includes(k)).length;

    if (advancedCount >= 3) return 'advanced';
    if (beginnerCount >= 3) return 'beginner';
    return 'intermediate';
  }

  /**
   * Infer preferred communication style (verbose vs brief).
   * @param {string} userId
   * @returns {'verbose' | 'brief'}
   */
  getPreferredStyle(userId) {
    const profile = this._userProfiles.get(userId);
    if (!profile || profile.messageSnippets.length === 0) return 'brief';

    const avgLength =
      profile.messageSnippets.reduce((sum, s) => sum + s.length, 0) /
      profile.messageSnippets.length;
    // If average message is > 100 chars, they prefer verbose
    return avgLength > 100 ? 'verbose' : 'brief';
  }

  /**
   * Extract keywords from a message for pattern matching.
   * @private
   * @param {string} text
   * @returns {string[]}
   */
  _extractKeywords(text) {
    // Simple keyword extraction (lowercase, split, filter common words)
    const stopWords = [
      'i',
      'the',
      'a',
      'an',
      'is',
      'are',
      'it',
      'my',
      'and',
      'or',
      'but',
      'to',
      'of',
    ];
    return text
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3 && !stopWords.includes(w));
  }

  /**
   * @private
   * @returns {void}
   */
  _cleanup() {
    const now = Date.now();
    for (const [key, entry] of this._store) {
      if (now - entry.timestamp > this._ttlSeconds * 1000) {
        this._store.delete(key);
      }
    }
    if (this._store.size > this._maxEntries) {
      const sorted = [...this._store.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toRemove = sorted.slice(0, this._store.size - this._maxEntries);
      for (const [key] of toRemove) {
        this._store.delete(key);
      }
    }
  }
}
