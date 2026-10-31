import { TauriBridge } from './bridge/tauri.js';
import { MockBridge } from './bridge/mock.js';
import { sceneFor } from './mock/scenes.js';
import { useSystemLanguage } from './i18n.js';
import { MonitorNotch } from './monitor-notch.js';
import { setPictureUrl } from './notch/notch.js';
import {
    dragFiles,
    fileUrl,
    hideWebMenu,
    inTauri,
    onDrop,
    onFullscreen,
    onKeyboard,
    onPointer,
    onTour,
    openFile,
    openSettings,
    openUri,
    releaseKeyboard,
    setHitRegion,
    systemUses24h,
    takeKeyboard,
    tourDone,
    tourWanted,
} from './platform.js';

/** The first-run tour opens this long after the app starts, once the desktop has settled. */
const TOUR_DELAY_MS = 2000;

useSystemLanguage();
hideWebMenu();
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
        openSettings,
        openFile,
        onDrop: app ? onDrop : (cb) => (mockDrop = cb),
        dragFiles,
    },
    document.body,
);
window.addEventListener('resize', () => notch.setArea(window.innerWidth));
await notch.start(window.innerWidth);
onTour(() => notch.startTour({ done: tourDone }));
if (await tourWanted()) window.setTimeout(() => notch.startTour({ done: tourDone }), TOUR_DELAY_MS);
if (mock) {
    if (scene.open) notch.open(true);
    if (scene.tour) notch.startTour({ done: () => {} });
    for (const selector of scene.click ?? []) document.querySelector<HTMLElement>(selector)?.click();
    for (const [iface, props] of scene.changes ?? []) mock.set(iface, props);
    for (const [iface, signal, ...args] of scene.signals ?? []) mock.signal(iface, signal, ...args);
    if (scene.drop) mockDrop(true);
    if (scene.menu) {
        const [clientX, clientY] = scene.menu;
        const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX, clientY });
        document.querySelector('.nokta-notch')?.dispatchEvent(event);
    }
}
