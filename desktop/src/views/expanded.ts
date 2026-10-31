import { coverShadow } from '@ext/features/media/logic/cover.js';
import { loopIcon, nextLoopStatus, shuffleIcon, type LoopStatus, type ToggleIcon } from '@ext/features/media/logic/loop.js';
import { neighbour, playerLabels, scrollStep, type PlayerEntry } from '@ext/features/media/logic/players.js';
import type { MediaSnapshot } from '@ext/features/media/logic/snapshot.js';
import { mix } from '@ext/shared/logic/color.js';
import { _ } from '@ext/shared/logic/i18n.js';

import { icon, setIcon } from '../icons.js';
import { Cover } from './cover.js';
import { Equalizer } from './equalizer.js';
import { LyricLine } from './lyric-line.js';
import { ProgressBar } from './progress.js';

/** What the open player asks of the active one. */
export interface MediaControls {
    playPause(): void;
    next(): void;
    previous(): void;
    setPosition(us: number): void;
    selectPlayer(id: string): void;
    setShuffle(on: boolean): void;
    setLoopStatus(status: LoopStatus): void;
    /** The music's band levels, for the equalizer; null without them. */
    levels(): readonly number[] | null;
}

function button(className: string, name: string, size: number, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = className;
    b.append(icon(name, size));
    b.addEventListener('click', onClick);
    return b;
}

/**
 * The open notch: cover, title, artists, the player switcher when there is
 * more than one player, the lyric row, progress with times, and shuffle /
 * previous / play-pause / next / repeat.
 */
export class ExpandedView {
    readonly element: HTMLDivElement;
    readonly progress: ProgressBar;
    readonly lyric = new LyricLine();
    private readonly cover = new Cover(64, 14);
    private readonly equalizer: Equalizer;
    private readonly title: HTMLDivElement;
    private readonly artists: HTMLDivElement;
    private readonly playerRow: HTMLDivElement;
    private readonly playerLabel: HTMLSpanElement;
    private readonly previous: HTMLButtonElement;
    private readonly playPause: HTMLButtonElement;
    private readonly next: HTMLButtonElement;
    private readonly shuffle: HTMLButtonElement;
    private readonly loop: HTMLButtonElement;
    private players: PlayerEntry[] = [];
    private playerId = '';
    private lastScrollMs = 0;
    private shuffleOn = false;
    private loopStatus: LoopStatus = 'None';
    private coverColor: string | null = null;
    private light = false;
    private playing = false;
    private active = false;

    /** `openHome` goes to the open notch's other page. */
    constructor(controls: MediaControls, openHome: () => void) {
        this.equalizer = new Equalizer(() => controls.levels());
        this.element = document.createElement('div');
        this.element.className = 'nokta-view nokta-expanded';

        const top = document.createElement('div');
        top.className = 'nokta-expanded-top';
        const info = document.createElement('div');
        info.className = 'nokta-expanded-info';
        this.title = document.createElement('div');
        this.title.className = 'nokta-title';
        this.artists = document.createElement('div');
        this.artists.className = 'nokta-artists';
        this.playerRow = document.createElement('div');
        this.playerRow.className = 'nokta-player-row';
        this.playerLabel = document.createElement('span');
        this.playerLabel.className = 'nokta-player-name';
        const switcher = (name: string, step: 1 | -1) =>
            button('nokta-button nokta-player-switch', name, 12, () => this.switchPlayer(step, controls));
        this.playerRow.append(switcher('pan-start', -1), this.playerLabel, switcher('pan-end', 1));
        this.playerRow.hidden = true;
        info.append(this.title, this.artists, this.playerRow);
        // A wheel click over the cover switches players.
        this.cover.element.addEventListener(
            'wheel',
            (e) => {
                const direction = e.deltaMode === WheelEvent.DOM_DELTA_PIXEL && Math.abs(e.deltaY) < 50 ? 'smooth' : e.deltaY > 0 ? 'down' : 'up';
                const nowMs = performance.now();
                const step = scrollStep(direction, nowMs, this.lastScrollMs);
                if (step !== 0 && this.switchPlayer(step, controls)) {
                    this.lastScrollMs = nowMs;
                    e.preventDefault();
                }
            },
            { passive: false },
        );
        const home = button('nokta-button nokta-home-button', 'view-app-grid', 16, openHome);
        top.append(this.cover.element, info, this.equalizer.element, home);

        this.progress = new ProgressBar((us) => controls.setPosition(us));

        const buttons = document.createElement('div');
        buttons.className = 'nokta-controls';
        this.shuffle = button('nokta-button nokta-toggle', 'media-playlist-shuffle', 16, () =>
            controls.setShuffle(!this.shuffleOn),
        );
        this.previous = button('nokta-button nokta-skip', 'media-skip-backward', 22, () => controls.previous());
        this.playPause = button('nokta-play', 'media-playback-start', 18, () => controls.playPause());
        this.next = button('nokta-button nokta-skip', 'media-skip-forward', 22, () => controls.next());
        this.loop = button('nokta-button nokta-toggle', 'media-playlist-repeat', 16, () =>
            controls.setLoopStatus(nextLoopStatus(this.loopStatus)),
        );
        buttons.append(this.shuffle, this.previous, this.playPause, this.next, this.loop);

        this.element.append(top, this.lyric.element, this.progress.element, buttons);
    }

    /** Puts `row` under the controls, like the shelf's. */
    addRow(row: HTMLElement): void {
        this.element.append(row);
    }

    update(snapshot: MediaSnapshot): void {
        this.cover.set(snapshot.artPath);
        this.coverColor = snapshot.artPath ? snapshot.accentColor : null;
        this.cover.setShadow(shadowOf(this.coverColor, this.light));
        this.playing = snapshot.playbackStatus === 'Playing';
        this.equalizer.setPlaying(this.active && this.playing);
        this.title.textContent = snapshot.title || snapshot.playerName;
        this.artists.textContent = snapshot.artists.join(', ');
        this.artists.hidden = snapshot.artists.length === 0;
        this.players = snapshot.players;
        this.playerId = snapshot.playerId;
        const index = this.players.findIndex(([id]) => id === this.playerId);
        this.playerRow.hidden = !(this.players.length > 1 && index >= 0);
        if (!this.playerRow.hidden) this.playerLabel.textContent = playerLabels(this.players)[index];
        setIcon(this.playPause.firstElementChild as HTMLElement, this.playing ? 'media-playback-pause' : 'media-playback-start', 18);
        this.playPause.setAttribute('aria-label', this.playing ? _('Pause') : _('Play'));
        this.previous.disabled = !snapshot.canGoPrevious;
        this.playPause.disabled = !snapshot.canPlayPause;
        this.next.disabled = !snapshot.canGoNext;
        this.shuffleOn = snapshot.shuffle;
        this.loopStatus = snapshot.loopStatus;
        this.showToggle(this.shuffle, snapshot.canShuffle, shuffleIcon(snapshot.shuffle));
        this.showToggle(this.loop, snapshot.canLoop, loopIcon(snapshot.loopStatus));
    }

    /** The play button is filled with the accent; shuffle and repeat take it while on. */
    setPalette({ accent, onAccent, light }: { accent: string; onAccent: string; light: boolean }): void {
        this.light = light;
        this.element.style.setProperty('--nokta-accent', accent);
        this.equalizer.setColor(accent);
        this.cover.setShadow(shadowOf(this.coverColor, light));
        this.playPause.style.background = `linear-gradient(${mix(accent, '#ffffff', 0.12)}, ${mix(accent, '#000000', 0.2)})`;
        this.playPause.style.color = onAccent;
    }

    /** Steps the equalizer only while the open player is on screen. */
    setActive(active: boolean): void {
        this.active = active;
        this.equalizer.setPlaying(active && this.playing);
    }

    destroy(): void {
        this.equalizer.destroy();
    }

    private switchPlayer(step: 1 | -1, controls: MediaControls): boolean {
        const id = neighbour(this.players, this.playerId, step);
        if (id) controls.selectPlayer(id);
        return id !== null;
    }

    /** Hidden when the player has none; dimmed while off. */
    private showToggle(b: HTMLButtonElement, supported: boolean, { icon: name, on }: ToggleIcon): void {
        b.hidden = !supported;
        setIcon(b.firstElementChild as HTMLElement, name, 16);
        b.classList.toggle('nokta-on', on);
    }
}

/** The extension's cover shadow, a St declaration, as a CSS `box-shadow` value. */
function shadowOf(color: string | null, light: boolean): string {
    return coverShadow(color, light).replace(/^box-shadow:\s*/, '').replace(/;$/, '');
}
