import { EventEmitter } from "node:events";
import { Connection } from "./Connection";
import { sseStringify, EventStream } from "sse-stringify";

interface Options {
  historySize?: number;
}

export class Session extends EventEmitter {
  private connections = new Set<Connection>();
  private lastEventIDs: string[] = [];
  private historySize: number;
  private historyStore: Map<string, string> = new Map();

  constructor(options?: Options) {
    super();
    this.historySize = options?.historySize || 500;
  }

  add(connection: Connection) {
    this.connections.add(connection);

    connection.once("close", () => this.remove(connection));
    if (connection.lastEventID) {
      // this.historyStore.has(connection.lastEventID) would be more cheap, but for now let's maintain our internal array as source of truth
      const index = this.lastEventIDs.findLastIndex(
        (eventID) => eventID === connection.lastEventID
      );
      if (index !== -1) {
        // send newer messages than the lastEventID received
        for (let x = index + 1; x < this.lastEventIDs.length; x++) {
          const oldMessage = this.historyStore.get(this.lastEventIDs[x]);
          if (oldMessage) connection.write(oldMessage);
        }
      }
    }
    return this;
  }

  remove(connection: Connection) {
    return this.connections.delete(connection);
  }

  count() {
    return this.connections.size;
  }

  send(value: EventStream) {
    const data = sseStringify(value);
    if (value.id && this.isHistoryEnabled()) {
      this.saveMessage(value.id, data);
    }
    this.connections.forEach((conn) => {
      conn.write(data);
    });
    return this;
  }

  write(value: string) {
    if (this.isHistoryEnabled()) {
      const regex = /^id:\s*(\S+)$/m;
      const result = value.match(regex);
      if (result) {
        this.saveMessage(result[1], value);
      }
    }
    this.connections.forEach((conn) => {
      conn.write(value);
    });
    return this;
  }

  private isHistoryEnabled() {
    if (this.historySize <= 0) {
      return false;
    }
    return true;
  }

  private saveMessage(id: string, value: string) {
    const newLength = this.lastEventIDs.push(id);
    this.historyStore.set(id, value);

    if (newLength > this.historySize) {
      const removedID = this.lastEventIDs.shift();
      if (removedID) this.historyStore.delete(removedID);
    }
  }
}
