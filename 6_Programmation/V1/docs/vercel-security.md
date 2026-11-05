# Vercel security configuration

The public library and live status are readable without authentication. Every physical control command requires an Auth.js session created with the shared controller password; administration requires the separate administrator account.

Add Vercel WAF fixed-window rules as defense in depth:

- Rate-limit `POST /api/pianos/*/commands` per IP, for example 20 requests per minute.
- Rate-limit `POST /api/auth/*` per IP, for example 10 attempts per ten minutes.
- Leave device endpoints outside the browser rule; they already require the per-piano bearer token and need stable heartbeat delivery.

These limits do not replace application authentication. The EMQX ACL remains a second boundary: browsers can subscribe to reported state but cannot publish desired commands.
