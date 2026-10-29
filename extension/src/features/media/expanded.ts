import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { setVertical } from '../../shared/compat.js';
import { mix } from '../../shared/logic/color.js';
import { Cover } from './cover.js';
import { Equalizer } from './equalizer.js';
import { coverShadow } from './logic/cover.js';
import { loopIcon, nextLoopStatus, shuffleIcon, type LoopStatus, type ToggleIcon } from './logic/loop.js';
import { outputIcon, type AudioOutput } from './logic/outputs.js';
import { neighbour, playerLabels, scrollStep, type PlayerEntry, type ScrollDirection } from './logic/players.js';
import type { MediaSnapshot } from './logic/snapshot.js';
import { OutputMenu, type OutputMenuHandlers } from './output-menu.js';
import { ProgressBar } from './progress.js';
import { iconFor } from '../../shared/icons.js';
import { SECONDARY, TERTIARY } from '../../shared/dim.js';

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

/** The play button's scale under the pointer and while pressed. */
const PLAY_HOVER = 1.06;
const PLAY_PRESSED = 0.9;

const SCROLL_DIRECTIONS: Partial<Record<Clutter.ScrollDirection, ScrollDirection>> = {
    [Clutter.ScrollDirection.UP]: 'up',
    [Clutter.ScrollDirection.DOWN]: 'down',
    [Clutter.ScrollDirection.LEFT]: 'left',
    [Clutter.ScrollDirection.RIGHT]: 'right',
};

function ellipsized(styleClass: string): St.Label {
    const label = new St.Label({ style_class: styleClass, x_expand: true });
    label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    return label;
}

/**
 * The open notch: cover, title, artists, the player switcher when there is
 * more than one player, an optional lyric row, progress with times, and
 * previous / play-pause / next.
 */
export class ExpandedMediaView {
    readonly actor: St.BoxLayout;
    readonly progress: ProgressBar;
    private readonly cover = new Cover(64, 14);
    private readonly equalizer: Equalizer;
    private readonly title = ellipsized('nokta-title');
    private readonly artists = ellipsized('nokta-artists');
    private readonly info: St.BoxLayout;
    private readonly previous: St.Button;
    private readonly playPause: St.Button;
    private readonly next: St.Button;
    private readonly shuffle: St.Button;
    private readonly loop: St.Button;
    private shuffleOn = false;
    private loopStatus: LoopStatus = 'None';
    private readonly playPauseIcon: St.Icon;
    private readonly playerRow: St.BoxLayout;
    private readonly playerLabel = ellipsized('nokta-player-name');
    private players: PlayerEntry[] = [];
    private playerId = '';
    private lastScrollMs = 0;
    private accent = '#ffffff';
    private light = false;
    private coverColor: string | null = null;
    private playing = false;
    private active = false;
    private readonly outputButton: St.Button;
    private readonly outputIcon: St.Icon;
    private readonly outputMenu: OutputMenu;
    private outputs: readonly AudioOutput[] = [];
    private activeOutput: number | null = null;

    /** `openHome` goes to the open notch's other page; `outputs` switches the sound output. */
    constructor(controls: MediaControls, openHome: () => void, outputs: OutputMenuHandlers) {
        this.equalizer = new Equalizer(() => controls.levels());
        this.actor = setVertical(new St.BoxLayout({ style_class: 'nokta-expanded', y_align: Clutter.ActorAlign.START }));

        const top = new St.BoxLayout({ style_class: 'nokta-expanded-top' });
        this.info = setVertical(new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER }));
        this.info.add_child(this.title);
        this.artists.opacity = SECONDARY;
        this.playerLabel.opacity = SECONDARY;
        this.info.add_child(this.artists);
        this.playerRow = new St.BoxLayout({ style_class: 'nokta-player-row' });
        this.playerLabel.x_expand = false;
        this.playerRow.add_child(this.switchButton('pan-start-symbolic', -1, controls));
        this.playerRow.add_child(this.playerLabel);
        this.playerRow.add_child(this.switchButton('pan-end-symbolic', 1, controls));
        this.playerRow.hide();
        this.info.add_child(this.playerRow);
        this.cover.actor.reactive = true;
        this.cover.actor.connect('scroll-event', (_actor, event: Clutter.Event) => {
            const direction = SCROLL_DIRECTIONS[event.get_scroll_direction()] ?? 'smooth';
            const nowMs = GLib.get_monotonic_time() / 1000;
            const step = scrollStep(direction, nowMs, this.lastScrollMs);
            if (step === 0 || !this.switchPlayer(step, controls)) return Clutter.EVENT_PROPAGATE;
            this.lastScrollMs = nowMs;
            return Clutter.EVENT_STOP;
        });
        top.add_child(this.cover.actor);
        top.add_child(this.info);
        // Beside the title, the bars say the song is playing, as in the closed notch.
        this.equalizer.actor.y_align = Clutter.ActorAlign.CENTER;
        top.add_child(this.equalizer.actor);
        const home = new St.Button({
            style_class: 'nokta-button nokta-home-button nokta-grid-button',
            child: new St.Icon({ gicon: iconFor('view-app-grid-symbolic'), style_class: 'nokta-home-icon' }),
            y_align: Clutter.ActorAlign.START,
            can_focus: true,
        });
        home.connect('clicked', openHome);
        this.outputIcon = new St.Icon({ gicon: iconFor(outputIcon(null)), style_class: 'nokta-home-icon' });
        this.outputButton = new St.Button({
            style_class: 'nokta-button nokta-home-button nokta-output-button',
            child: this.outputIcon,
            y_align: Clutter.ActorAlign.START,
            can_focus: true,
            visible: false,
        });
        this.outputMenu = new OutputMenu(this.outputButton, outputs);
        this.outputButton.connect('clicked', () => this.outputMenu.open(this.outputs, this.activeOutput));
        top.add_child(this.outputButton);
        top.add_child(home);

        this.progress = new ProgressBar((us) => controls.setPosition(us));

        const buttons = new St.BoxLayout({ style_class: 'nokta-controls', x_align: Clutter.ActorAlign.CENTER });
        this.previous = this.button('media-skip-backward-symbolic', () => controls.previous());
        this.playPauseIcon = new St.Icon({ gicon: iconFor('media-playback-start-symbolic'), style_class: 'nokta-play-icon' });
        this.playPause = new St.Button({ style_class: 'nokta-play', child: this.playPauseIcon, can_focus: true });
        this.playPause.set_pivot_point(0.5, 0.5);
        this.playPause.connect('clicked', () => controls.playPause());
        // A press sinks the button in, the pointer lifts it a little.
        const lift = () => {
            const scale = this.playPause.pressed ? PLAY_PRESSED : this.playPause.hover ? PLAY_HOVER : 1;
            this.playPause.ease({ scale_x: scale, scale_y: scale, duration: 120, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
        };
        this.playPause.connect('notify::pressed', lift);
        this.playPause.connect('notify::hover', lift);
        this.next = this.button('media-skip-forward-symbolic', () => controls.next());
        for (const skip of [this.previous, this.next]) skip.add_style_class_name('nokta-skip');
        this.shuffle = this.button('media-playlist-shuffle-symbolic', () => controls.setShuffle(!this.shuffleOn));
        this.loop = this.button('media-playlist-repeat-symbolic', () =>
            controls.setLoopStatus(nextLoopStatus(this.loopStatus)),
        );
        for (const toggle of [this.shuffle, this.loop]) toggle.add_style_class_name('nokta-toggle');
        buttons.add_child(this.shuffle);
        buttons.add_child(this.previous);
        buttons.add_child(this.playPause);
        buttons.add_child(this.next);
        buttons.add_child(this.loop);

        this.actor.add_child(top);
        this.actor.add_child(this.progress.actor);
        this.actor.add_child(buttons);
    }

    update(snapshot: MediaSnapshot): void {
        this.cover.set(snapshot.artPath);
        this.coverColor = snapshot.artPath ? snapshot.accentColor : null;
        this.cover.setShadow(coverShadow(this.coverColor, this.light));
        this.playing = snapshot.playbackStatus === 'Playing';
        this.equalizer.setPlaying(this.active && this.playing);
        this.title.text = snapshot.title || snapshot.playerName;
        this.artists.text = snapshot.artists.join(', ');
        this.artists.visible = snapshot.artists.length > 0;
        this.players = snapshot.players;
        this.playerId = snapshot.playerId;
        const index = this.players.findIndex(([id]) => id === this.playerId);
        this.playerRow.visible = this.players.length > 1 && index >= 0;
        if (this.playerRow.visible) this.playerLabel.text = playerLabels(this.players)[index];
        this.playPauseIcon.gicon = iconFor(
            snapshot.playbackStatus === 'Playing' ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic',
        );
        this.enable(this.previous, snapshot.canGoPrevious);
        this.enable(this.playPause, snapshot.canPlayPause);
        this.enable(this.next, snapshot.canGoNext);
        this.shuffleOn = snapshot.shuffle;
        this.loopStatus = snapshot.loopStatus;
        this.showToggle(this.shuffle, snapshot.canShuffle, shuffleIcon(snapshot.shuffle));
        this.showToggle(this.loop, snapshot.canLoop, loopIcon(snapshot.loopStatus));
    }

    /** The play button is filled with the accent; shuffle and repeat take it while on. */
    setPalette({ accent, onAccent, light }: { accent: string; onAccent: string; light: boolean }): void {
        this.accent = accent;
        this.light = light;
        this.equalizer.setColor(accent);
        this.cover.setShadow(coverShadow(this.coverColor, light));
        this.playPause.style =
            'background-gradient-direction: vertical;' +
            ` background-gradient-start: ${mix(accent, '#ffffff', 0.12)};` +
            ` background-gradient-end: ${mix(accent, '#000000', 0.2)}; color: ${onAccent};`;
        this.showToggle(this.shuffle, this.shuffle.visible, shuffleIcon(this.shuffleOn));
        this.showToggle(this.loop, this.loop.visible, loopIcon(this.loopStatus));
    }

    /** The speaker button shows the output in use; it hides with one output or none. */
    setOutputs(outputs: readonly AudioOutput[], activeId: number | null): void {
        this.outputs = outputs;
        this.activeOutput = activeId;
        this.outputIcon.gicon = iconFor(outputIcon(outputs.find((o) => o.id === activeId) ?? null));
        this.outputButton.visible = outputs.length > 1;
        if (!this.outputButton.visible) this.outputMenu.close();
    }

    /** Steps the equalizer only while the open player is on screen. */
    setActive(active: boolean): void {
        this.active = active;
        this.equalizer.setPlaying(active && this.playing);
    }

    /** The notch is closing: the menu goes with it. */
    closeMenus(): void {
        this.outputMenu.close();
    }

    destroy(): void {
        this.equalizer.destroy();
        this.outputMenu.destroy();
        this.progress.destroy();
        this.actor.destroy();
    }

    /** Asks for the next or previous player; false when there is none. */
    private switchPlayer(step: 1 | -1, controls: MediaControls): boolean {
        const id = neighbour(this.players, this.playerId, step);
        if (id) controls.selectPlayer(id);
        return id !== null;
    }

    private switchButton(icon: string, step: 1 | -1, controls: MediaControls): St.Button {
        const button = new St.Button({
            style_class: 'nokta-button nokta-player-switch',
            child: new St.Icon({ gicon: iconFor(icon), style_class: 'nokta-player-switch-icon', opacity: SECONDARY }),
            can_focus: true,
        });
        button.connect('clicked', () => this.switchPlayer(step, controls));
        return button;
    }

    private button(icon: string, onClick: () => void): St.Button {
        const button = new St.Button({
            style_class: 'nokta-button',
            child: new St.Icon({ gicon: iconFor(icon), style_class: 'nokta-button-icon' }),
            can_focus: true,
        });
        button.connect('clicked', onClick);
        return button;
    }

    /** Hidden when the player has none; dimmed while off. */
    private showToggle(button: St.Button, supported: boolean, { icon, on }: ToggleIcon): void {
        button.visible = supported;
        const child = button.child as St.Icon;
        child.gicon = iconFor(icon);
        child.style = on ? `color: ${this.accent};` : '';
        button.opacity = on ? 255 : TERTIARY;
    }

    private enable(button: St.Button, enabled: boolean): void {
        button.reactive = enabled;
        button.can_focus = enabled;
        button.opacity = enabled ? 255 : 90;
    }
}
