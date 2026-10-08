/**
 * Подмножество типов MAX Bot API. Источник — официальный SDK @maxhub/max-bot-api 1.0.1 (сентябрь 2026):
 * базовый адрес platform-api2.max.ru, токен в заголовке Authorization без «Bearer».
 * Поля, которые бот не читает, не описаны: лишнее в JSON просто игнорируется.
 */

export type User = {
  user_id: number;
  first_name?: string;
  last_name?: string | null;
  name?: string;
  username?: string | null;
  is_bot?: boolean;
};

export type ChatType = "dialog" | "chat" | "channel";

export type MediaPayload = { url?: string | null; token?: string | null };

export type Attachment =
  | { type: "image"; payload: MediaPayload & { photo_id?: number } }
  | { type: "video"; payload: MediaPayload }
  | { type: "audio"; payload: MediaPayload }
  | { type: "file"; payload: MediaPayload; filename?: string; size?: number }
  | { type: "sticker"; payload: { url?: string; code?: string } }
  | { type: "inline_keyboard"; payload: { buttons: Button[][] } }
  | { type: "contact" | "share" | "location"; payload?: unknown };

export type MessageBody = {
  mid: string;
  seq?: number;
  text: string | null;
  attachments?: Attachment[] | null;
};

export type Message = {
  sender?: User | null;
  recipient: { chat_id: number | null; chat_type: ChatType; user_id: number | null };
  timestamp: number;
  link?: { type: "forward" | "reply"; sender?: User | null; chat_id?: number; message: MessageBody } | null;
  body: MessageBody;
};

export type CallbackButton = { type: "callback"; text: string; payload: string };
export type LinkButton = { type: "link"; text: string; url: string };
export type MessageButton = { type: "message"; text: string };
export type Button = CallbackButton | LinkButton | MessageButton;

export type KeyboardAttachment = { type: "inline_keyboard"; payload: { buttons: Button[][] } };

/** Тело исходящего сообщения (POST /messages, PUT /messages, message в POST /answers). */
export type NewMessageBody = {
  text?: string | null;
  attachments?: KeyboardAttachment[] | null;
  link?: { type: "reply" | "forward"; mid: string } | null;
  notify?: boolean;
  format?: "markdown" | "html" | null;
};

export type BotCommand = { name: string; description?: string | null };

export type BotInfo = User & { commands?: BotCommand[] | null };

export type UpdateType = "message_created" | "message_callback" | "bot_started";

export type Update =
  | { update_type: "message_created"; timestamp: number; message: Message; user_locale?: string | null }
  | {
      update_type: "message_callback";
      timestamp: number;
      callback: { timestamp: number; callback_id: string; payload?: string; user: User };
      message?: Message | null;
      user_locale?: string | null;
    }
  | {
      update_type: "bot_started";
      timestamp: number;
      chat_id: number;
      user: User;
      payload?: string | null;
      user_locale?: string | null;
    }
  | { update_type: string; timestamp?: number };

export type Subscription = { url: string; time?: number; update_types?: string[] | null };

export type SenderAction = "typing_on" | "sending_photo" | "sending_file";
