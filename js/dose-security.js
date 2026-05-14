/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║ RoboForge - Dose Robot Simulator                            ║
 * ║ Created by: Rishik Saravanan                                ║
 * ║ Birthday: May 25th                                          ║
 * ║ © 2024-2026. All rights reserved.                           ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

/**
 * Security module for DOSE simulator access control
 * Handles session-based authentication and watermarking
 */

class DoseSecurityManager {
  static SESSION_KEY = 'dose_auth_token_rs_0525';
  static TIMESTAMP_KEY = 'dose_auth_time_rs_0525';
  static MAX_SESSION_TIME = 8 * 60 * 60 * 1000; // 8 hours
  static CREATOR_WATERMARK = 'Rishik Saravanan • May 25th • RoboForge';

  /**
   * Generate a secure session token
   * Incorporates creator watermark and timestamp
   */
  static generateToken() {
    const randomPart = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(16).slice(2);
    const token = `rs_dose_${Date.now()}_${randomPart}`;
    return token;
  }

  /**
   * Validate and authenticate user
   * Stores session token only on successful password match
   */
  static authenticate(password) {
    // Hash password with watermark for comparison
    const hashInput = password + this.CREATOR_WATERMARK;
    const hash = this._hashString(hashInput);
    
    // Actual password hash (generated from hashing "dose" + watermark)
    const validHash = this._hashString('dose' + this.CREATOR_WATERMARK);
    
    if (hash === validHash) {
      const token = this.generateToken();
      sessionStorage.setItem(this.SESSION_KEY, token);
      sessionStorage.setItem(this.TIMESTAMP_KEY, Date.now().toString());
      return true;
    }
    return false;
  }

  /**
   * Check if current session is valid
   */
  static isSessionValid() {
    const token = sessionStorage.getItem(this.SESSION_KEY);
    const timestamp = sessionStorage.getItem(this.TIMESTAMP_KEY);
    
    if (!token || !timestamp) return false;
    
    const sessionAge = Date.now() - parseInt(timestamp);
    if (sessionAge > this.MAX_SESSION_TIME) {
      this.clearSession();
      return false;
    }
    
    return token.startsWith('rs_dose_');
  }

  /**
   * Clear session (e.g., on logout)
   */
  static clearSession() {
    sessionStorage.removeItem(this.SESSION_KEY);
    sessionStorage.removeItem(this.TIMESTAMP_KEY);
  }

  /**
   * Simple hash function incorporating creator watermark
   * This prevents direct URL access without proper authentication
   */
  static _hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash >>>= 0; // Keep as unsigned 32-bit
    }
    return hash.toString(16);
  }

  /**
   * Get watermark for logging/identification
   */
  static getWatermark() {
    return this.CREATOR_WATERMARK;
  }
}

export { DoseSecurityManager };
