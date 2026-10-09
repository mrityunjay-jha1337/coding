declare module 'zeptomail' {
  export interface EmailAddress {
    address: string;
    name?: string;
  }

  export interface Recipient {
    email_address: EmailAddress;
  }

  export interface Attachment {
    name?: string;
    content?: string;
    mime_type?: string;
    file_cache_key?: string;
  }

  export interface SendMailOptions {
    from: EmailAddress;
    to: Recipient[];
    cc?: Recipient[];
    bcc?: Recipient[];
    reply_to?: EmailAddress[];
    subject: string;
    htmlbody?: string;
    textbody?: string;
    attachments?: Attachment[];
    track_clicks?: boolean;
    track_opens?: boolean;
    client_reference?: string;
    mime_headers?: Record<string, string>;
  }

  export interface SendMailResponseEntry {
    code?: string;
    additional_info?: unknown;
    message?: string;
    message_id?: string;
  }

  export interface SendMailResponse {
    data?: SendMailResponseEntry[];
    message?: string;
    request_id?: string;
    object?: string;
  }

  export interface SendMailClientOptions {
    url: string;
    token: string;
    domain?: string;
    debug?: boolean;
  }

  export class SendMailClient {
    constructor(options: SendMailClientOptions);
    sendMail(options: SendMailOptions): Promise<SendMailResponse>;
    sendBatchMail(options: SendMailOptions): Promise<SendMailResponse>;
    sendMailWithTemplate(options: unknown): Promise<SendMailResponse>;
    mailBatchWithTemplate(options: unknown): Promise<SendMailResponse>;
  }
}
