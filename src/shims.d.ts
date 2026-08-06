// Ambient module declarations for libraries whose bundled types conflict
// with our strict-ts integration usage. We still keep masterchat's real
// types (used for the constructor), but the event-emitter `on` overloads
// are loosened via `any` casts at the call sites.
declare module "tmi.js";
declare module "pusher-js";
