/**
 * Copyright (c) 2021 OpenLens Authors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
 * FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
 * IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

import { autorun, observable, when } from "mobx";
import { autoBind, noop } from "../../utils";
import { Terminal } from "./terminal";
import { TerminalApi } from "../../api/terminal-api";
import { dockStore, IDockTab, TabId, TabKind } from "./dock.store";
import { WebSocketApiState } from "../../api/websocket-api";
import { Notifications } from "../notifications";

export interface ITerminalTab extends IDockTab {
  node?: string; // activate node shell mode
}

export function createTerminalTab(tabParams: Partial<ITerminalTab> = {}) {
  return dockStore.createTab({
    kind: TabKind.TERMINAL,
    title: `Terminal`,
    ...tabParams
  });
}

export class TerminalStore {
  protected terminals = new Map<TabId, Terminal>();
  protected connections = observable.map<TabId, TerminalApi>();

  constructor() {
    autoBind(this);

    // connect active tab
    autorun(() => {
      const { selectedTab, isOpen } = dockStore;

      if (selectedTab?.kind === TabKind.TERMINAL && isOpen) {
        this.connect(selectedTab.id);
      }
    });
    // disconnect closed tabs
    autorun(() => {
      const currentTabs = dockStore.tabs.map(tab => tab.id);

      for (const [tabId] of this.connections) {
        if (!currentTabs.includes(tabId)) this.disconnect(tabId);
      }
    });
  }

  connect(tabId: TabId) {
    if (this.isConnected(tabId)) {
      return;
    }
    const tab: ITerminalTab = dockStore.getTabById(tabId);
    const api = new TerminalApi({
      id: tabId,
      node: tab.node,
    });
    const terminal = new Terminal(tabId, api);

    this.connections.set(tabId, api);
    this.terminals.set(tabId, terminal);
  }

  disconnect(tabId: TabId) {
    if (!this.isConnected(tabId)) {
      return;
    }
    const terminal = this.terminals.get(tabId);
    const terminalApi = this.connections.get(tabId);

    terminal.destroy();
    terminalApi.destroy();
    this.connections.delete(tabId);
    this.terminals.delete(tabId);
  }

  reconnect(tabId: TabId) {
    this.connections.get(tabId)?.connect();
  }

  isConnected(tabId: TabId) {
    return Boolean(this.connections.get(tabId));
  }

  isDisconnected(tabId: TabId) {
    return this.connections.get(tabId)?.readyState === WebSocketApiState.CLOSED;
  }

  async sendCommand(command: string, options: { enter?: boolean; newTab?: boolean; tabId?: TabId } = {}) {
    const { enter, newTab, tabId } = options;

    if (tabId) {
      dockStore.selectTab(tabId);
    }

    if (newTab) {
      const tab = createTerminalTab();

      await when(() => this.connections.has(tab.id));

      const rcIsFinished = when(() => this.connections.get(tab.id).rcFinished);
      const notifyLong = setTimeout(() => {
        Notifications.info("Terminal shell is taking a long time to complete startup. Please check your .rc file.", {
          timeout: 4_000,
        });
      }, 2_500);
      const notifyVeryLong = setTimeout(() => {
        rcIsFinished.cancel();
        Notifications.info("Bypassing shell completion check.", {
          timeout: 4_000,
        });
      }, 7_500);

      await rcIsFinished.catch(noop);
      clearTimeout(notifyLong);
      clearTimeout(notifyVeryLong);
    }

    const terminalApi = this.connections.get(dockStore.selectedTabId);

    if (terminalApi) {
      terminalApi.sendCommand(command + (enter ? "\r" : ""));
    } else {
      console.warn("The selected tab is does not have a connection. Cannot send command.", { tabId: dockStore.selectedTabId, command });
    }
  }

  getTerminal(tabId: TabId) {
    return this.terminals.get(tabId);
  }

  reset() {
    [...this.connections].forEach(([tabId]) => {
      this.disconnect(tabId);
    });
  }
}

export const terminalStore = new TerminalStore();
