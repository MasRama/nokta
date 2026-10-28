import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    CALL_COLORS,
    callDetail,
    callingStream,
    callText,
    callTitle,
    msUntilCallChange,
    type RecordingStream,
} from '../src/features/privacy/logic/call.js';

const S = 1_000_000;

const stream = (appId: string, name = '', iconName = ''): RecordingStream => ({ appId, name, iconName });

test('the call is the first app recording that is not a sound settings window', () => {
    const settings = stream('org.gnome.VolumeControl', 'Settings');
    const pavucontrol = stream('org.PulseAudio.pavucontrol', 'Volume Control');
    const firefox = stream('org.mozilla.firefox', 'Firefox');
    assert.equal(callingStream([settings, firefox, stream('discord')]), firefox);
    assert.equal(callingStream([settings, pavucontrol]), null);
    assert.equal(callingStream([]), null);
});

test('a call is named after its app, else the stream, else the microphone', () => {
    assert.equal(callTitle('Zoom', stream('us.zoom.Zoom', 'ZOOM VoiceEngine')), 'Zoom');
    assert.equal(callTitle(null, stream('', 'WEBRTC VoiceEngine')), 'WEBRTC VoiceEngine');
    assert.equal(callTitle(null, null), 'Microphone');
});

test('the call time counts up from when the microphone came on', () => {
    assert.equal(callText(10 * S, 10 * S + 63 * S + 400_000), '1:03');
    assert.equal(callText(0, 3725 * S), '1:02:05');
    assert.equal(callText(5 * S, 0), '0:00');
    assert.equal(callDetail(0, 63 * S, false), 'Microphone · 1:03');
    assert.equal(callDetail(0, 63 * S, true), 'Muted · 1:03');
});

test('the call time is redrawn when its second changes', () => {
    assert.equal(msUntilCallChange(0, 10 * S + 250_000), 750);
    assert.equal(msUntilCallChange(S, S), 1000);
});

test('a muted microphone shows red', () => {
    assert.notEqual(CALL_COLORS.live, CALL_COLORS.muted);
    assert.equal(CALL_COLORS.muted, '#ff453a');
});
