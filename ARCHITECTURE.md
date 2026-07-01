# ARCHITECTURE

## System Context

``` text
Kontur Talk
    │
tabCapture
    │
Chrome Extension
    │ WebSocket
localhost:8000/asr
    │
WhisperLiveKit
    │
Local Whisper Model
```

## Components

### Chrome Extension

-   Popup
-   Content Script
-   Service Worker
-   Overlay
-   Sidebar
-   Audio capture

### WhisperLiveKit

-   AudioProcessor
-   TranscriptionEngine
-   VAD
-   Token Alignment
-   WebSocket API

### Thin Adapter

-   Meeting Manager
-   Transcript Store
-   Export Service
-   Health Check

## Sequence

1.  Detect meeting
2.  Connect to localhost
3.  Capture PCM
4.  Stream to `/asr`
5.  Receive partial transcript
6.  Render overlay
7.  Persist transcript
8.  Export on demand

## State Machine

Idle → CheckingAgent → Connecting → Listening → Reconnecting → Finished

## ADR-001

Decision: Use WhisperLiveKit as the transcription backend without
forking core modules.

Reason: - Mature streaming pipeline - Existing WebSocket protocol -
Lower implementation cost

Consequence: Product code focuses on UX and integration instead of ASR.
