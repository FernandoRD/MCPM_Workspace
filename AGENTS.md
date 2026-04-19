<claude-mem-context>
# Memory Context

# [ssh_vault] recent context, 2026-04-18 9:24pm GMT-3

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 49 obs (21,776t read) | 815,966t work | 97% savings

### Apr 18, 2026
55 10:04a 🔵 ssh_vault Git Repository Has 697MB Pack — Blocking GitHub Push
57 10:05a 🔵 Root Cause Found: Rust Build Artifacts Committed in 16c74d8 Block GitHub Push
58 10:07a 🔴 git filter-branch Successfully Rewrote Local History — Removed 6,344 Build Artifacts from 9 Commits
62 10:08a 🔵 History Rewrite Verified Clean: Largest Remaining Blob is 14.6MB — Push Should Succeed
64 10:10a 🔵 Local Pack Still 704MB After gc — Old Blobs Retained by alteracao-esquema-ssh/telnet Branch and origin/main Tracking Ref
65 10:13a 🔵 ssh_vault Gitignore Audit: viewer_mvp Binaries Are Intentionally Tracked in src-tauri/resources/
67 10:14a 🔵 Root .gitignore Line 34 Ignores All Nested .gitignore Files — clients/internal-rdp-client/.gitignore Not Tracked
69 10:16a 🔴 .gitignore Updated: Fixed Path for clients/, Removed Buggy .gitignore Self-Ignore Rule
70 10:39a 🔵 User Querying VNC Support Status in ssh_vault
71 " 🔵 VNC Protocol: Fully Implemented End-to-End in ssh_vault
73 10:40a 🔵 VNC Architecture: WebviewWindow Route (Not System Terminal)
81 1:13p ⚖️ VNC Session Refactor Plan: 4-Step Implementation Strategy
82 " 🔵 VNC Architecture Surface Map: Types, Store, and i18n
84 " 🔵 ssh_vault Backend Module Map and VNC Handler Registration
87 1:14p 🔵 TECHNICAL_REFERENCE.md: RDP and VNC Still Use WebviewWindow Architecture
90 " 🔵 README.md Feature List Omits VNC from Summary Paragraph
91 1:16p 🟣 vnc.rs: New Session Contract with VncSessionMode and Lifecycle Capability Flags
92 " 🔴 VncPage.tsx Patch Partially Applied — Disconnect Button Block Not Found
93 1:19p 🟣 VncPage.tsx: Capability-Aware UI for Lifecycle Monitoring and Session Control
94 " ✅ VNC i18n, Settings UI, README, and TECHNICAL_REFERENCE Updated for Session Contract Refactor
96 " ✅ VNC Session Contract Refactor: Steps 1–3 Complete, Build Validation Started
97 1:22p 🔴 vnc.rs Dead Code Warning Fixed: can_disconnect_client Removed from VncSession Struct
99 1:28p ⚖️ Settings Screen Reorganization: Group Elements by Type
100 1:29p 🔵 Settings.tsx: Current Section Order Has VNC Misplaced Between Appearance and Language
102 1:32p 🔄 Settings.tsx: Section Order Fixed and SettingPanel Layout Component Introduced
103 " 🟣 SettingPanel Component Added to Settings.tsx
105 1:33p ✅ Settings.tsx Reorganization Verified: Build Passes, Final Layout Confirmed
108 1:36p 🔵 ssh_vault Full Architecture Map: VNC Capability Flags, RDP Dual-Mode, and Type Surface
115 6:52p ⚖️ Comprehensive Logging Requirement: SFTP and All Error Types
117 " 🔵 ssh_vault Logging Gap: sftp.rs Has Zero log:: Calls Despite `log` Crate Being Present
118 6:54p 🔵 Comprehensive Logging Audit Complete: Full Gap Map and Implementation Plan Formed
121 6:55p 🟣 Persistent File Logger Implemented: src-tauri/src/app_logging.rs
122 6:57p 🔵 sftp.rs Instrumentation Patch Failed: Duplicate Apply on Already-Modified File
126 " 🟣 sftp.rs Phase 1 Instrumentation Applied: SftpConnection Context, log_error Helper, get_connection Helper
127 7:00p 🟣 sftp.rs Full Instrumentation Complete: All 9 Commands Now Emit Structured log:: Entries
138 8:54p 🔵 Logging Coverage Gap Question: SSH/Telnet, RDP, and VNC Not Explicitly Covered in S26
140 " 🔵 Logging Coverage Audit: SSH Has Minimal Logging, Telnet/VNC Have Zero Logging, RDP Logs Only to ssh_vault_viewer.log
141 8:58p 🔵 VNC Settings Excluded from PortableSyncSettings — Not Synced Across Devices
143 8:59p 🔵 Telnet Backend Silently Swallows TCP Read Errors in Session Loop
144 9:01p ⚖️ New Logging Enhancement Plan: Configurable Directory, Protocol Instrumentation, and In-App Log Viewer
148 " 🟣 app_logging.rs Rewritten: Configurable Log Directory, File Listing, and In-App File Reading Commands
149 9:04p 🟣 SSH and Telnet Backends Fully Instrumented with Structured Logging
150 " 🟣 RDP Backend Fully Instrumented and Viewer Log Relocated to Configured Log Directory
156 " 🟣 VNC Backend Logging Instrumentation — Partial: vnc_log_error Helper Added, Session Lifecycle Patch Failed Due to Code Mismatch
164 9:18p 🔵 LogsPage.tsx: Current Layout Architecture Before Scrollbar Fix
165 " 🔵 AppLayout main Uses overflow-auto — Root Cause of LogsPage Height Issue
167 9:19p 🟣 LogsPage.tsx: Fixed Log Viewer Height — Scrollable Panels with Fixed 28rem Height
169 9:23p 🔄 LogsPage.tsx: Responsive Height Tuning — Asymmetric Panel Sizes with xl Breakpoints
171 9:24p 🔴 LogsPage.tsx: Scrollable Log Viewer — Final State with Responsive Heights, Build Clean

Access 816k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>