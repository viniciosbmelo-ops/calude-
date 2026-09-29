// Side-effect module imported first in main.tsx so the app header is in place
// before any other module can issue a request.
import { installAppHeader } from "./app-header";

installAppHeader();
