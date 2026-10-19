import { disableTool } from "eve/tools";

// Message text and photos are untrusted. Without shell, file, or open web
// access, injected instructions have no channel to run code or send data out.
export default disableTool();
