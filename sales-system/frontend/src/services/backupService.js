import { request } from "./api.js";
export const getBackupInfo = () => request("/api/backups");
