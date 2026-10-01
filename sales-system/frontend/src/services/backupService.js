import { request } from "./api.js";
export const getBackupInfo = () => request("http://localhost:5000/api/backups");
