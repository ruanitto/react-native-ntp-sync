import { NtpServer } from "./types";

const getFieldValue = (obj: any) => {
  if (!obj) {
    return "Empty";
  }
  if (typeof obj === "string") {
    return obj;
  }
  return obj.toString();
};

export class NtpClientError extends Error {
  server: NtpServer;
  constructor(underlyingError: Error, server: NtpServer) {
    super(underlyingError.message);
    this.name = getFieldValue(underlyingError.name);
    this.message = getFieldValue(underlyingError.message);
    this.stack = underlyingError.stack;
    this.server = server;
  }
}
