export class GatewayUnavailableError extends Error {
  constructor(reason, message, options) {
    super(message, options);
    this.name = 'GatewayUnavailableError';
    this.reason = reason;
  }
}
