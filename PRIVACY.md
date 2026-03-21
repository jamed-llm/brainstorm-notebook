# Privacy Policy — Brainstorm Notebook

**Last updated:** March 22, 2026

## Overview

Brainstorm Notebook is a Chrome extension that generates mind-map graphs from AI conversations. This policy explains what data the extension accesses, how it is used, and how it is stored.

## Data Collection

Brainstorm Notebook does **not** collect, transmit, or store any personal data on external servers. The extension has no backend, no analytics, and no tracking.

## Data Accessed

The extension accesses the following data solely to fulfill its core functionality:

- **Conversation text** on claude.ai, chatgpt.com, and gemini.google.com — read from the page DOM to extract conversation turns for graph generation. This text is only processed locally or sent to an AI API provider that *you* configure.
- **API keys** — provided by the user in the extension options page, encrypted locally using AES-256-GCM with a user-set passphrase, and stored in Chrome's local storage. Keys are never sent anywhere except the corresponding API provider (Anthropic, OpenAI, or Google) to perform graph analysis.

## Data Storage

All data is stored locally on your device using Chrome's `chrome.storage.local` API:

- Mind-map graphs (nodes, edges, positions) — per conversation
- Encrypted API keys and salt
- User preferences (e.g., LLM toggle state)

No data is synced to the cloud or shared across devices.

## Third-Party Services

When LLM mode is enabled, conversation turns are sent to the AI API provider whose key you configured:

- **Anthropic API** (api.anthropic.com) — if using an Anthropic key
- **OpenAI API** (api.openai.com) — if using an OpenAI key
- **Google Gemini API** (generativelanguage.googleapis.com) — if using a Gemini key

These requests are made directly from your browser to the provider's API. No intermediary servers are involved. The data sent consists of conversation text for analysis. Refer to each provider's privacy policy for how they handle API requests.

When LLM mode is disabled, no external requests are made. All processing happens locally.

## Data Sharing

Brainstorm Notebook does **not** share, sell, or transfer any user data to third parties for any purpose, including but not limited to advertising, analytics, or data brokering.

## Data Retention

All data remains on your device until you clear it. You can delete saved graphs at any time from the extension's options page using the cache management controls.

Uninstalling the extension removes all stored data.

## Changes to This Policy

Updates to this policy will be reflected in this document with an updated date. Continued use of the extension after changes constitutes acceptance.

## Contact

For questions about this privacy policy, please open an issue at the project's GitHub repository.
