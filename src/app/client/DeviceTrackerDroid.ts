import '../../style/devicelist.css';
import { BaseDeviceTracker } from './BaseDeviceTracker';
import { ACTION, SERVER_PORT } from '../../common/Constants';
import DroidDeviceDescriptor from '../../types/DroidDeviceDescriptor';
import querystring from 'querystring';
import { ScrcpyStreamParams } from '../../types/ScrcpyStreamParams';
import { ControlCenterCommand } from '../../common/ControlCenterCommand';
import { StreamClientScrcpy } from './StreamClientScrcpy';
import SvgImage from '../ui/SvgImage';
import { html } from '../ui/HtmlTag';
import { DevtoolsClient } from './DevtoolsClient';
import { ShellClient } from './ShellClient';
import Util from '../Util';
import Url from 'url';
import { Attribute } from '../Attribute';
import { HostItem } from '../../types/Configuration';

type Field = keyof DroidDeviceDescriptor | ((descriptor: DroidDeviceDescriptor) => string);
type DescriptionColumn = { title: string; field: Field };

const DESC_COLUMNS: DescriptionColumn[] = [
    {
        title: 'Net Interface',
        field: 'interfaces',
    },
    {
        title: 'Server PID',
        field: 'pid',
    },
];

export class DeviceTrackerDroid extends BaseDeviceTracker<DroidDeviceDescriptor, never> {
    public static readonly ACTION = ACTION.DROID_DEVICE_LIST;
    public static readonly CREATE_DIRECT_LINKS = true;
    public static readonly AttributePrefixInterfaceSelectFor = 'interface_select_for_';
    public static readonly AttributePlayerFullName = 'data-player-full-name';
    public static readonly AttributePlayerCodeName = 'data-player-code-name';
    public static readonly AttributePrefixPlayerFor = 'player_for_';
    private static instancesByUrl: Map<string, DeviceTrackerDroid> = new Map();
    private readonly url: string;
    private created = false;
    private secure: boolean;
    private hostname: string;
    private port: string;

    public static start(itemOrUrl: HostItem | string): DeviceTrackerDroid {
        if (typeof itemOrUrl === 'string') {
            return this.getInstanceByUrl(itemOrUrl);
        }
        return this.getInstance(itemOrUrl);
    }

    public static getInstanceByUrl(url: string): DeviceTrackerDroid {
        let instance = this.instancesByUrl.get(url);
        if (!instance) {
            const parsed = Url.parse(url);
            const secure = parsed.protocol === 'wss';
            const hostname = parsed.hostname || '';
            let { port } = parsed;
            if (!port) {
                port = secure ? '443' : '80';
            }
            instance = new DeviceTrackerDroid({ type: 'android', secure, hostname, port });
            this.instancesByUrl.set(url, instance);
        }
        return instance;
    }

    public static getInstance(item: HostItem): DeviceTrackerDroid {
        const url = this.buildUrl(item);
        let instance = this.instancesByUrl.get(url);
        if (!instance) {
            instance = new DeviceTrackerDroid(item);
            this.instancesByUrl.set(url, instance);
        }
        return instance;
    }

    public static buildUrl(item: HostItem): string {
        const { secure, port, hostname } = item;
        const protocol = secure ? 'wss:' : 'ws:';
        return Url.format({
            protocol,
            hostname,
            port,
            search: `action=${this.ACTION}`,
            pathname: '/',
            slashes: true,
        });
    }

    protected constructor(item: HostItem) {
        super(DeviceTrackerDroid.ACTION);
        this.secure = item.secure;
        this.hostname = item.hostname;
        this.port = item.port;
        this.url = DeviceTrackerDroid.buildUrl(item);
        this.openNewWebSocket();
    }

    protected onSocketOpen(): void {
        // if (this.hasConnection()) {
        //     this.ws.send(JSON.stringify({ command: 'list' }));
        // }
    }

    protected buildTableHead(): HTMLTableSectionElement {
        throw new Error('Method not implemented.');
    }

    protected setIdAndHostName(id: string, hostName: string): void {
        super.setIdAndHostName(id, hostName);
        for (const value of DeviceTrackerDroid.instancesByUrl.values()) {
            if (value.id === id && value !== this) {
                console.warn(
                    `Tracker with url: "${this.url}" has the same id(${this.id}) as tracker with url "${value.url}"`,
                );
                console.warn(`This tracker will shut down`);
                this.destroy();
            }
        }
    }

    protected removeList(): void {
        const element = document.getElementById(`tracker_${this.id}`);
        if (!element) {
            return;
        }
        const parent = element.parentElement;
        if (!parent) {
            return;
        }
        parent.removeChild(element);
    }

    onInterfaceSelected = (e: Event): void => {
        const selectElement = e.currentTarget as HTMLSelectElement;
        DeviceTrackerDroid.updateLink(selectElement, true);
    };

    private static updateLink(selectElement: HTMLSelectElement, store: boolean): void {
        const option = selectElement.selectedOptions[0];
        const url = decodeURI(option.getAttribute(Attribute.URL) || '');
        const name = option.getAttribute(Attribute.NAME);
        const fullName = decodeURIComponent(selectElement.getAttribute(Attribute.FULL_NAME) || '');
        const udid = selectElement.getAttribute(Attribute.UDID);
        const playerTds = document.getElementsByName(encodeURIComponent(`${this.AttributePrefixPlayerFor}${fullName}`));
        if (typeof udid !== 'string') {
            return;
        }
        if (store) {
            const localStorageKey = DeviceTrackerDroid.getLocalStorageKey(fullName || '');
            if (localStorage && name) {
                localStorage.setItem(localStorageKey, name);
            }
        }
        const action = 'stream';
        playerTds.forEach((item) => {
            item.innerHTML = '';
            const playerFullName = item.getAttribute(this.AttributePlayerFullName);
            const playerCodeName = item.getAttribute(this.AttributePlayerCodeName);
            if (!playerFullName || !playerCodeName) {
                return;
            }
            const q: ScrcpyStreamParams = {
                action,
                udid,
                player: decodeURIComponent(playerCodeName),
                ws: url,
            };
            const link = BaseDeviceTracker.buildLink(q, decodeURIComponent(playerFullName));
            item.appendChild(link);
        });
    }

    onActionButtonClick = (e: MouseEvent): void => {
        const button = e.currentTarget as HTMLButtonElement;
        const udid = button.getAttribute(Attribute.UDID);
        const pidString = button.getAttribute(Attribute.PID) || '';
        const command = button.getAttribute(Attribute.COMMAND) as string;
        const pid = parseInt(pidString, 10);
        const data: { command: string; udid?: string; pid?: number } = { command };
        if (typeof udid === 'string') {
            data.udid = udid;
        }
        if (!isNaN(pid)) {
            data.pid = pid;
        }

        if (this.hasConnection()) {
            (this.ws as WebSocket).send(JSON.stringify(data));
        }
    };

    private static getLocalStorageKey(udid: string): string {
        return `device_list::${udid}::interface`;
    }

    private static createInterfaceOption(
        secure: boolean,
        hostname: string,
        port: string | number,
        name: string,
        udid = '',
    ): HTMLOptionElement {
        const optionElement = document.createElement('option');
        const search = udid
            ? querystring.encode({
                  action: 'proxy',
                  remote: `tcp:${SERVER_PORT.toString(10)}`,
                  udid: udid,
              })
            : '';
        const url = Url.format({
            protocol: secure ? 'wss:' : 'ws:',
            hostname,
            port,
            search,
            pathname: '/',
            slashes: true,
        });
        optionElement.setAttribute(Attribute.URL, url);
        optionElement.setAttribute(Attribute.NAME, name);
        optionElement.innerText = `proxy over adb`;
        return optionElement;
    }

    private static titleToClassName(title: string): string {
        return title.toLowerCase().replace(/\s/g, '_');
    }

    protected getOrBuildTableBody(parent: HTMLElement): Element {
        const className = 'device-list';
        let tbody = document.querySelector(`#devices #${this.tableId}.${className}`) as Element;
        if (!tbody) {
            const fragment = html`<div id="${this.tableId}" class="${className}"></div>`.content;
            parent.appendChild(fragment);
            const last = parent.children.item(parent.children.length - 1);
            if (last) {
                tbody = last;
            }
        }
        return tbody;
    }

    protected buildDeviceTable(): void {
        const data = this.descriptors;
        const devices = this.getOrCreateTableHolder();
        const tbody = this.getOrBuildTableBody(devices);

        const block = this.getOrCreateTrackerBlock(tbody, this.hostName);
        data.forEach((item) => {
            this.buildDeviceRow(block, item);
        });
    }

    private getOrCreateTrackerBlock(parent: Element, controlCenterName: string): Element {
        const id = `tracker_${this.id}`;
        let el = document.getElementById(id);
        if (!el) {
            el = document.createElement('div');
            el.id = id;
            parent.appendChild(el);
            this.created = true;
        } else {
            while (el.children.length) {
                el.removeChild(el.children[0]);
            }
        }
        const nameBlockId = `${id}_name`;
        let nameEl = document.getElementById(nameBlockId);
        if (!nameEl) {
            nameEl = document.createElement('div');
            nameEl.id = nameBlockId;
            nameEl.className = 'tracker-name';
        }
        nameEl.innerText = controlCenterName;
        el.insertBefore(nameEl, el.firstChild);
        return el;
    }

    private buildDeviceRow(tbody: Element, device: DroidDeviceDescriptor): void {
        const blockClass = 'desc-block';
        const fullName = `${this.id}_${Util.escapeUdid(device.udid)}`;
        const isActive = device.state === 'device';
        const localStorageKey = DeviceTrackerDroid.getLocalStorageKey(fullName);
        const lastSelected = localStorage && localStorage.getItem(localStorageKey);
        let hasPid = false;
        let selectInterface: HTMLSelectElement | undefined;
        const servicesId = `device_services_${fullName}`;
        const row = html`<div class="device ${isActive ? 'active' : 'not-active'}">
            <div class="device-header">
                <div class="device-name">${device['ro.product.manufacturer']} ${device['ro.product.model']}</div>
                <div class="device-serial">${device.udid}</div>
                <div class="device-version">
                    <div class="release-version">${device['ro.build.version.release']}</div>
                    <div class="sdk-version">${device['ro.build.version.sdk']}</div>
                </div>
                <div class="device-state" title="State: ${device.state}"></div>
            </div>
            <div id="${servicesId}" class="services"></div>
        </div>`.content;
        const services = row.getElementById(servicesId);
        if (!services) {
            return;
        }

        const shellEntry = ShellClient.createEntryForDeviceList(device, blockClass, {
            secure: this.secure,
            hostname: this.hostname,
            port: this.port,
        });
        shellEntry && services.appendChild(shellEntry);
        const devtoolsEntry = DevtoolsClient.createEntryForDeviceList(device, blockClass, {
            secure: this.secure,
            hostname: this.hostname,
            port: this.port,
        });
        devtoolsEntry && services.appendChild(devtoolsEntry);

        const streamEntry = StreamClientScrcpy.createEntryForDeviceList(device, blockClass, this.url, fullName);
        streamEntry && services.appendChild(streamEntry);

        DESC_COLUMNS.forEach((item) => {
            const { title } = item;
            const fieldName = item.field;
            let value: string;
            if (typeof item.field === 'string') {
                value = '' + device[item.field];
            } else {
                value = item.field(device);
            }
            const td = document.createElement('div');
            td.classList.add(DeviceTrackerDroid.titleToClassName(title), blockClass);
            services.appendChild(td);
            if (fieldName === 'pid') {
                hasPid = value !== '-1';
                const actionButton = document.createElement('button');
                actionButton.className = 'action-button kill-server-button';
                actionButton.setAttribute(Attribute.UDID, device.udid);
                actionButton.setAttribute(Attribute.PID, value);
                let command: string;
                if (isActive) {
                    actionButton.classList.add('active');
                    actionButton.onclick = this.onActionButtonClick;
                    if (hasPid) {
                        command = ControlCenterCommand.KILL_SERVER;
                        actionButton.title = 'Kill server';
                        actionButton.appendChild(SvgImage.create(SvgImage.Icon.CANCEL));
                    } else {
                        command = ControlCenterCommand.START_SERVER;
                        actionButton.title = 'Start server';
                        actionButton.appendChild(SvgImage.create(SvgImage.Icon.REFRESH));
                    }
                    actionButton.setAttribute(Attribute.COMMAND, command);
                } else {
                    const timestamp = device['last.seen.active.timestamp'];
                    if (timestamp) {
                        const date = new Date(timestamp);
                        actionButton.title = `Last seen on ${date.toLocaleDateString()} at ${date.toLocaleTimeString()}`;
                    } else {
                        actionButton.title = `Not active`;
                    }
                    actionButton.appendChild(SvgImage.create(SvgImage.Icon.OFFLINE));
                }
                const span = document.createElement('span');
                span.innerText = value;
                actionButton.appendChild(span);
                td.appendChild(actionButton);
            } else if (fieldName === 'interfaces') {
                const selectElement = document.createElement('select');
                selectElement.setAttribute(Attribute.UDID, device.udid);
                selectElement.setAttribute(Attribute.FULL_NAME, fullName);
                selectElement.setAttribute(
                    'name',
                    encodeURIComponent(`${DeviceTrackerDroid.AttributePrefixInterfaceSelectFor}${fullName}`),
                );
                device[fieldName].forEach((value) => {
                    const optionElement = DeviceTrackerDroid.createInterfaceOption(
                        false,
                        value.ipv4,
                        SERVER_PORT.toString(10),
                        value.name,
                    );
                    optionElement.innerText = `${value.name}: ${value.ipv4}`;
                    selectElement.appendChild(optionElement);
                    if (lastSelected) {
                        if (lastSelected === value.name) {
                            optionElement.selected = true;
                        }
                    } else if (device['wifi.interface'] === value.name) {
                        optionElement.selected = true;
                    }
                });
                if (isActive) {
                    const adbProxyOption = DeviceTrackerDroid.createInterfaceOption(
                        this.secure,
                        this.hostname,
                        this.port,
                        'proxy',
                        device.udid,
                    );
                    if (lastSelected === 'proxy') {
                        adbProxyOption.selected = true;
                    }
                    selectElement.appendChild(adbProxyOption);
                    const actionButton = document.createElement('button');
                    actionButton.className = 'action-button update-interfaces-button active';
                    actionButton.title = `Update information`;
                    actionButton.appendChild(SvgImage.create(SvgImage.Icon.REFRESH));
                    actionButton.setAttribute(Attribute.UDID, device.udid);
                    actionButton.setAttribute(Attribute.COMMAND, ControlCenterCommand.UPDATE_INTERFACES);
                    actionButton.onclick = this.onActionButtonClick;
                    td.appendChild(actionButton);
                }
                selectElement.onchange = this.onInterfaceSelected;
                td.appendChild(selectElement);
                selectInterface = selectElement;
            } else {
                td.innerText = value;
            }
        });

        if (DeviceTrackerDroid.CREATE_DIRECT_LINKS) {
            const name = `${DeviceTrackerDroid.AttributePrefixPlayerFor}${fullName}`;
            StreamClientScrcpy.getPlayers().forEach((playerClass) => {
                const { playerCodeName, playerFullName } = playerClass;
                const playerTd = document.createElement('div');
                playerTd.classList.add(blockClass);
                playerTd.setAttribute('name', encodeURIComponent(name));
                playerTd.setAttribute(DeviceTrackerDroid.AttributePlayerFullName, encodeURIComponent(playerFullName));
                playerTd.setAttribute(DeviceTrackerDroid.AttributePlayerCodeName, encodeURIComponent(playerCodeName));
                services.appendChild(playerTd);
            });
        }

        tbody.appendChild(row);
        if (DeviceTrackerDroid.CREATE_DIRECT_LINKS && hasPid && selectInterface) {
            DeviceTrackerDroid.updateLink(selectInterface, false);
        }
    }

    protected buildWebSocketUrl(): string {
        return this.url;
    }

    public destroy(): void {
        super.destroy();
        if (this.created) {
            const el = document.getElementById(`tracker_${this.id}`);
            if (el && el.parentElement) {
                el.parentElement.removeChild(el);
            }
        }
        DeviceTrackerDroid.instancesByUrl.delete(this.url);
        if (!DeviceTrackerDroid.instancesByUrl.size) {
            const holder = document.getElementById(BaseDeviceTracker.HOLDER_ELEMENT_ID);
            if (holder && holder.parentElement) {
                holder.parentElement.removeChild(holder);
            }
        }
    }
}
