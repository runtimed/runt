// deno-lint-ignore-file no-explicit-any

/*
 * BSD 3-Clause License
 *
 * Copyright (c) 2015, Nicolas Riesco and others as credited in the AUTHORS file
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice,
 * this list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 * this list of conditions and the following disclaimer in the documentation
 * and/or other materials provided with the distribution.
 *
 * 3. Neither the name of the copyright holder nor the names of its contributors
 * may be used to endorse or promote products derived from this software without
 * specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 *
 */

import { v4 as uuid } from "uuid";
import * as crypto from "node:crypto";
import { Buffer } from "node:buffer";
import { createLogger } from "@runt/lib";


const DELIMITER = "<IDS|MSG>";
const logger = createLogger("jmp");
export class Message {
  idents: unknown[];
  header: Record<string, unknown>;
  parent_header: Record<string, unknown>;
  metadata: Record<string, unknown>;
  content: Record<string, unknown>;
  buffers: unknown[];

  constructor(properties?: {
    idents?: unknown[];
    header?: Record<string, unknown>;
    parent_header?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    content?: Record<string, unknown>;
    buffers?: unknown[];
  }) {
    this.idents = (properties && properties.idents) || [];
    this.header = (properties && properties.header) || {};
    this.parent_header = (properties && properties.parent_header) || {};
    this.metadata = (properties && properties.metadata) || {};
    this.content = (properties && properties.content) || {};
    this.buffers = (properties && properties.buffers) || [];
  }

  respond(
    socket: unknown,
    messageType: string,
    content?: Record<string, unknown>,
    metadata?: Record<string, unknown>,
    protocolVersion?: string
  ): Message {
    const response = new Message();
    response.idents = this.idents;
    response.header = {
      msg_id: uuid(),
      username: (this.header as any).username,
      session: (this.header as any).session,
      msg_type: messageType,
    };
    if (this.header && (this.header as any).version) {
      response.header.version = (this.header as any).version;
    }
    if (protocolVersion) {
      response.header.version = protocolVersion;
    }
    response.parent_header = this.header;
    response.content = content || {};
    response.metadata = metadata || {};
    (socket as any).send(response);
    return response;
  }

  static _decode(
    messageFrames: unknown[],
    scheme?: string,
    key?: string,
    loggingContext?: Record<string, unknown>
  ): Message | null {
    try {
      return _decode(messageFrames, scheme, key, loggingContext);
    } catch (err) {
      let formattedErr = err;
      if (err instanceof Uint8Array) {
        formattedErr = `Uint8Array[${err.length}]: ${Array.from(err).map(b => b.toString(16).padStart(2, "0")).join(" ")}`;
      } else if (Array.isArray(err)) {
        formattedErr = `Array[${err.length}]: ${err.map(e => typeof e === "number" ? e.toString(16).padStart(2, "0") : String(e)).join(" ")}`;
      } else if (typeof err === "object" && err !== null && "toString" in err) {
        formattedErr = err.toString();
      }
      logger.error("MESSAGE: DECODE: Error:", err, { ...loggingContext, message: formattedErr });
    }
    return null;
  }

  _encode(scheme?: string, key?: string): unknown[] {
    scheme = scheme || "sha256";
    key = key || "";
    const idents = this.idents;
    const header = JSON.stringify(this.header);
    const parent_header = JSON.stringify(this.parent_header);
    const metadata = JSON.stringify(this.metadata);
    const content = JSON.stringify(this.content);
    let signature = "";
    if (key) {
      const hmac = crypto.createHmac(scheme, key);
      const encoding = "utf8";
      hmac.update(Buffer.from(header, encoding));
      hmac.update(Buffer.from(parent_header, encoding));
      hmac.update(Buffer.from(metadata, encoding));
      hmac.update(Buffer.from(content, encoding));
      signature = hmac.digest("hex");
    }
    const response = idents.concat([
      DELIMITER,
      signature,
      header,
      parent_header,
      metadata,
      content,
    ]).concat(this.buffers);
    return response;
  }
}

function _decode(
  messageFrames: unknown[],
  scheme?: string,
  key?: string,
  loggingContext?: Record<string, unknown>
): Message | null {
  scheme = scheme || "sha256";
  key = key || "";
  let i = 0;
  const idents: unknown[] = [];
  // Diagnostic: log each frame as we search for the delimiter
  for (i = 0; i < messageFrames.length; i++) {
    const frame = messageFrames[i];
    let frameStr: string;
    if (frame instanceof Uint8Array) {
      try {
        frameStr = new TextDecoder().decode(frame);
      } catch {
        frameStr = String(frame);
      }
    } else {
      frameStr = String(frame);
    }
    logger.debug("[DECODE] Checking frame", {
      ...loggingContext,
      frameIndex: i,
      frameType: typeof frame,
      frameValue: frameStr,
      delimiterExpected: DELIMITER
    });
    if (frameStr === DELIMITER) {
      logger.debug("[DECODE] Delimiter found", {
        ...loggingContext,
        delimiterIndex: i,
        delimiterValue: frameStr
      });
      break;
    }
    idents.push(frame);
  }
  // Fix: require at least 5 frames after the delimiter
  if (messageFrames.length - (i + 1) < 5) {
    logFramesError(
      "MESSAGE: DECODE: Not enough message frames",
      messageFrames,
      loggingContext
    );
    return null;
  }
  if (typeof messageFrames[i] === "undefined" || (function(frame) {
    if (frame instanceof Uint8Array) {
      try {
        return new TextDecoder().decode(frame) === DELIMITER;
      } catch {
        return false;
      }
    } else {
      return String(frame) === DELIMITER;
    }
  })(messageFrames[i]) === false) {
    logFramesError(
      "MESSAGE: DECODE: Missing delimiter",
      messageFrames,
      loggingContext
    );
    return null;
  }
  if (key) {
    let obtainedSignature: string;
    const sigFrame = messageFrames[i + 1];
    if (sigFrame instanceof Uint8Array) {
      try {
        obtainedSignature = new TextDecoder().decode(sigFrame);
      } catch {
        obtainedSignature = Array.from(sigFrame).map(b => b.toString(16).padStart(2, "0")).join("");
      }
    } else {
      obtainedSignature = String(sigFrame);
    }
    const hmac = crypto.createHmac(scheme, key);
    hmac.update(Buffer.isBuffer(messageFrames[i + 2]) ? messageFrames[i + 2] as Buffer : Buffer.from(messageFrames[i + 2] as string));
    hmac.update(Buffer.isBuffer(messageFrames[i + 3]) ? messageFrames[i + 3] as Buffer : Buffer.from(messageFrames[i + 3] as string));
    hmac.update(Buffer.isBuffer(messageFrames[i + 4]) ? messageFrames[i + 4] as Buffer : Buffer.from(messageFrames[i + 4] as string));
    hmac.update(Buffer.isBuffer(messageFrames[i + 5]) ? messageFrames[i + 5] as Buffer : Buffer.from(messageFrames[i + 5] as string));
    const expectedSignature = hmac.digest("hex");
    if (expectedSignature !== obtainedSignature) {
      logger.error(
        "MESSAGE: DECODE: Incorrect message signature",
        undefined,
        {
          ...loggingContext,
          obtained: obtainedSignature,
          expected: expectedSignature,
          frames: formatFrames(messageFrames).join("\n")
        }
      );
      return null;
    }
  }
  const message = new Message({
    idents: idents,
    header: toJSON(messageFrames[i + 2]),
    parent_header: toJSON(messageFrames[i + 3]),
    content: toJSON(messageFrames[i + 5]),
    metadata: toJSON(messageFrames[i + 4]),
    buffers: Array.prototype.slice.apply(messageFrames, [i + 6]),
  });
  return message;
  function toJSON(value: unknown): Record<string, unknown> {
    let str: string;
    if (value instanceof Uint8Array) {
      try {
        str = new TextDecoder().decode(value);
      } catch {
        str = value.toString();
      }
    } else {
      str = String(value);
    }
    return JSON.parse(str);
  }
}

function formatFrames(frames: unknown[]): string[] {
  return frames.map((frame, idx) => {
    if (frame instanceof Uint8Array) {
      const hex = Array.from(frame)
        .map(b => b.toString(16).padStart(2, "0"))
        .join(" ");
      let str = "";
      try {
        str = new TextDecoder().decode(frame);
      } catch {}
      // Truncate long hex dumps for readability
      const maxHexLen = 80;
      const hexDisplay = hex.length > maxHexLen ? hex.slice(0, maxHexLen) + " ..." : hex;
      // Show both hex and string, always
      return `[#${idx}] Uint8Array[${frame.length}]: ${hexDisplay}${str ? ` | \"${str}\"` : ""}`;
    } else if (typeof frame === "string") {
      return `[#${idx}] String: \"${frame}\"`;
    } else if (typeof frame === "object" && frame !== null) {
      try {
        return `[#${idx}] Object: ${JSON.stringify(frame)}`;
      } catch {
        return `[#${idx}] Object: ${frame.toString()}`;
      }
    } else {
      return `[#${idx}] ${String(frame)}`;
    }
  });
}

// Update logger.error calls to join frames with newlines
function logFramesError(message: string, frames: unknown[], loggingContext?: Record<string, unknown>) {
  logger.error(
    message,
    undefined,
    { ...loggingContext, frames: formatFrames(frames).join("\n") }
  );
}
