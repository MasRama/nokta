import assert from 'node:assert/strict';
import { test } from 'node:test';

import { QuietBanners, wantsQuiet } from '../src/features/timer/logic/quiet.js';
import { EMPTY_TIMER, type TimerSnapshot } from '../src/features/timer/logic/timer.js';

/** GNOME's show-banners key, with a log of what Nokta wrote. */
function fakeBanners(initial: boolean) {
    const port = {
        value: initial,
        writes: [] as boolean[],
        get: () => port.value,
        set: (value: boolean) => {
            port.value = value;
            port.writes.push(value);
        },
    };
    return port;
}

const focus = (state: 'running' | 'paused', phase: 'focus' | 'break' = 'focus'): TimerSnapshot => ({
    ...EMPTY_TIMER,
    state,
    phase,
});

test('quiet_only_while_a_focus_session_runs_and_the_setting_is_on', () => {
    assert.equal(wantsQuiet(focus('running'), true), true);
    assert.equal(wantsQuiet(focus('running'), false), false);
    assert.equal(wantsQuiet(focus('paused'), true), false);
    assert.equal(wantsQuiet(focus('running', 'break'), true), false);
    assert.equal(wantsQuiet(EMPTY_TIMER, true), false);
});

test('banners_go_off_during_focus_and_come_back_after', () => {
    const port = fakeBanners(true);
    const quiet = new QuietBanners(port);
    quiet.update(true);
    quiet.update(true);
    assert.equal(port.value, false);
    quiet.update(false);
    assert.equal(port.value, true);
    assert.deepEqual(port.writes, [false, true]);
});

test('banners_already_off_are_left_alone', () => {
    const port = fakeBanners(false);
    const quiet = new QuietBanners(port);
    quiet.update(true);
    quiet.update(false);
    quiet.release();
    assert.deepEqual(port.writes, []);
    assert.equal(port.value, false);
});

test('a_user_who_turns_banners_on_during_focus_keeps_them', () => {
    const port = fakeBanners(true);
    const quiet = new QuietBanners(port);
    quiet.update(true);
    port.value = true;
    quiet.update(false);
    assert.deepEqual(port.writes, [false]);
    assert.equal(port.value, true);
});

test('release_restores_once', () => {
    const port = fakeBanners(true);
    const quiet = new QuietBanners(port);
    quiet.update(true);
    quiet.release();
    quiet.release();
    assert.deepEqual(port.writes, [false, true]);
});

test('do_not_disturb_turned_on_during_focus_stays_on_after', () => {
    const port = fakeBanners(true);
    const quiet = new QuietBanners(port);
    quiet.update(true);
    quiet.setDoNotDisturb(true);
    quiet.update(true);
    quiet.update(false);
    quiet.release();
    assert.equal(port.value, false);
});

test('do_not_disturb_turned_off_during_focus_is_not_undone', () => {
    const port = fakeBanners(true);
    const quiet = new QuietBanners(port);
    quiet.update(true);
    quiet.setDoNotDisturb(false);
    quiet.update(true);
    quiet.update(false);
    assert.equal(port.value, true);
    assert.deepEqual(port.writes, [false, true]);
});

test('the_next_focus_session_quiets_banners_again', () => {
    const port = fakeBanners(true);
    const quiet = new QuietBanners(port);
    quiet.update(true);
    quiet.setDoNotDisturb(false);
    quiet.update(false);
    quiet.update(true);
    assert.equal(port.value, false);
});

test('do_not_disturb_is_whether_banners_are_off', () => {
    const port = fakeBanners(true);
    const quiet = new QuietBanners(port);
    assert.equal(quiet.doNotDisturb, false);
    quiet.setDoNotDisturb(true);
    assert.equal(quiet.doNotDisturb, true);
    assert.equal(port.value, false);
});
