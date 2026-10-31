import { TauriBridge } from './bridge/tauri.js';
import { MockBridge } from './bridge/mock.js';
import { sceneFor } from './mock/scenes.js';
import { MonitorNotch } from './monitor-notch.js';
import { setPictureUrl } from './notch/notch.js';
import {
    dragFiles,
    fileUrl,
    inTauri,
    onDrop,
    onFullscreen,
    onKeyboard,
    onPointer,
    openFile,
    openUri,
    releaseKeyboard,
    setHitRegion,
    systemUses24h,
    takeKeyboard,
} from './platform.js';

const app = inTauri();
const scene = sceneFor(location.search);
// Outside the app the page stands in for the desktop, so shots show the notch on a wallpaper.
if (!app) document.body.classList.add('nokta-mock');
setPictureUrl(fileUrl);

const mock = app ? null : new MockBridge(scene.props);
/** The mock's stand-in for files dragged over the notch. */
let mockDrop: (dropping: boolean) => void = () => {};
const notch = new MonitorNotch(
    mock ?? new TauriBridge(),
    {
        systemUses24h,
        setHit: (hit) => void setHitRegion(hit),
        onPointer,
        onFullscreen,
        onKeyboard,
        releaseKeyboard,
        takeKeyboard,
        openUri,
        openFile,
        onDrop: app ? onDrop : (cb) => (mockDrop = cb),
        dragFiles,
    },
    document.body,
);
window.addEventListener('resize', () => notch.setArea(window.innerWidth));
await notch.start(window.innerWidth);
if (mock) {
    if (scene.open) notch.open(true);
    for (const selector of scene.click ?? []) document.querySelector<HTMLElement>(selector)?.click();
    for (const [iface, props] of scene.changes ?? []) mock.set(iface, props);
    for (const [iface, signal, ...args] of scene.signals ?? []) mock.signal(iface, signal, ...args);
    if (scene.drop) mockDrop(true);
}
