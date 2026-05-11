<!--
╔══════════════════════════════════════════════════════════════╗
║ RoboForge - About Page                                      ║
║ Created by: Rishik Saravanan                                ║
║ Birthday: May 25th                                          ║
║ © 2024-2026. All rights reserved.                           ║
║ Unauthorized copying or distribution is prohibited.         ║
╚══════════════════════════════════════════════════════════════╝
-->

# RoboForge Security Implementation

## Creator & Copyright Information
- **Project**: RoboForge
- **Created by**: Rishik Saravanan
- **Birthday**: May 25th
- **Copyright**: © 2024-2026
- **License**: All rights reserved

## Code Watermarking
Every source file in this project includes a watermark containing:
- Creator name: Rishik Saravanan
- Birthday: May 25th
- Copyright and licensing information

This watermarking serves to:
1. Protect against unauthorized copying and distribution
2. Identify the source and creator of the code
3. Establish clear ownership and licensing

## DOSE Robot Simulator Authentication

### Session-Based Access Control
The DOSE robot simulator is now protected with session-based authentication:

**How it works:**
1. User enters password on the index.html dashboard
2. Password is verified using a secure hash function that incorporates the creator watermark
3. On successful authentication, a session token is stored in `sessionStorage`
4. The token includes:
   - Creator watermark
   - Cryptographic hash
   - Timestamp

**Security Benefits:**
- **No Direct URL Access**: Users cannot bypass the password by directly navigating to `dose.html`
- **Session Expiration**: Sessions automatically expire after 8 hours
- **Watermark Integration**: Authentication incorporates creator information, preventing simple token manipulation
- **Anti-Tampering**: Session validation checks for proper token format

### Token Management

**Session Keys:**
- `dose_auth_token_rs_0525`: Main authentication token
- `dose_auth_time_rs_0525`: Session timestamp for expiration

**Token Format:**
```
rs_dose_[hash]_[timestamp]
```
The token must start with `rs_dose_` and is validated on every page load.

### Session Timeout
- **Maximum Duration**: 8 hours
- **Timeout Action**: Redirects to dashboard and clears session

### Password Hashing
The password is hashed using:
1. Concatenation with creator watermark: `password + "Rishik Saravanan • May 25th • RoboForge"`
2. 32-bit hash function with XOR operations
3. Hexadecimal representation

This prevents simple password storage and makes the authentication process unique to this project.

## File Protection

### Watermarked Modules
The following files contain creator watermarks:

**Dose Robot Simulator:**
- `js/dose-main.js` - Main simulation engine
- `js/dose-arm.js` - Robot arm controller
- `js/dose-mesh.js` - 3D mesh builder
- `js/dose-physics.js` - Physics engine
- `js/dose-environment.js` - Environment builder
- `dose.html` - Simulator interface

**Drone Simulator:**
- `js/drone-main.js` - Drone simulation engine
- `drone.html` - Drone interface

**Core Robotics:**
- `js/main.js` - Main application
- `js/robot.js` - Robot definitions
- `js/ik.js` - Inverse kinematics solver
- `js/dynamics.js` - Dynamics calculations
- `arm.html` - Arm builder interface
- `index.html` - Dashboard

**Security Module:**
- `js/dose-security.js` - Authentication and session management

## Best Practices for Source Protection

### Against Direct Copy
1. All modules include creator watermarks that cannot be easily removed
2. Watermarks are embedded in security checks, making them functional (not just cosmetic)
3. Cross-references to watermarks in authentication logic

### Against URL Bypass
1. The DOSE simulator requires valid session tokens
2. Tokens are generated with project-specific information
3. Sessions expire automatically
4. Navigating directly to `dose.html` without a valid token redirects to dashboard

### Against Code Tampering
1. Security module is imported and used throughout the application
2. Watermark information is embedded in authentication hashes
3. Session validation happens before any DOSE-related code executes

## Authorization

This software is proprietary. Unauthorized copying, modification, or distribution is prohibited.

**Permitted Use:**
- Personal use for learning and development
- Use as authorized by Rishik Saravanan

**Prohibited Use:**
- Copying source code without permission
- Redistribution of modified versions
- Commercial use without authorization
- Removal or modification of copyright notices and watermarks

## Questions or Issues?

For questions about usage or licensing, please contact the creator.

---

**RoboForge** © 2024-2026 Rishik Saravanan. All rights reserved.
