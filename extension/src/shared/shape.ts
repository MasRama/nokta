import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';

/*
 * The notch's silhouette (ears, body, corners, gradient, border) and the glow
 * under it, drawn by one fragment shader. Size, radius and colours are
 * uniforms, so a frame of a resize costs no relayout, no restyle and no
 * Cairo, and the edges sit between pixels with antialiasing.
 *
 * Coordinates are the actor's pixels, y down from the top of the screen. The
 * body spans `u_half.x` either side of `u_center` and is `u_half.y` tall; its
 * top runs off the actor, so only its bottom corners round.
 */
const DECLARATIONS = `
uniform vec2 u_size;
uniform float u_center;
uniform vec2 u_half;
uniform float u_ear;
uniform float u_radius;
uniform float u_glow;
uniform vec4 u_top;
uniform vec4 u_bottom;
uniform vec4 u_border;
uniform vec2 u_direction;

float nokta_body(vec2 p, float grow) {
    float r = min(u_radius + grow, u_half.x + grow);
    vec2 half_size = vec2(u_half.x + grow, (u_half.y + grow + u_radius + 2.0) * 0.5);
    vec2 center = vec2(0.0, (u_half.y + grow - u_radius - 2.0) * 0.5);
    vec2 q = abs(p - center) - half_size + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float nokta_erf(float x) {
    float a = abs(x);
    float t = 1.0 / (1.0 + 0.3275911 * a);
    float y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t
        + 0.254829592) * t * exp(-a * a);
    return x < 0.0 ? -y : y;
}
`;

const CODE = `
vec2 p = cogl_tex_coord_in[0].xy * u_size;
p.x -= u_center;
vec4 color;
if (u_glow > 0.5) {
    // A box-shadow of 0 4px 24px 4px: offset, blurred, spread.
    float d = nokta_body(p - vec2(0.0, 4.0), 4.0);
    float a = u_top.a * 0.5 * (1.0 - nokta_erf(d / (12.0 * 1.41421356)));
    color = vec4(u_top.rgb * a, a);
} else {
    float d = nokta_body(p, 0.0);
    float body = clamp(0.5 - d, 0.0, 1.0);
    // The ears: the corner between the top edge and the body's side, minus a
    // quarter circle, so the edge curves into the notch.
    float px = abs(p.x);
    float ear = 0.0;
    if (p.y <= u_ear && px <= u_half.x + u_ear)
        ear = clamp(length(vec2(px, p.y) - vec2(u_half.x + u_ear, u_ear)) - u_ear + 0.5, 0.0, 1.0);
    float cover = max(body, ear);
    // 0 at the gradient's start and 1 at its end: the body's spot, 0..1 across
    // and down, along the direction.
    vec2 spot = vec2(p.x / max(2.0 * u_half.x, 1.0) + 0.5, p.y / max(u_half.y, 1.0));
    float t = dot(spot, u_direction) / max(u_direction.x + u_direction.y, 0.001);
    vec4 fill = mix(u_top, u_bottom, clamp(t, 0.0, 1.0));
    color = vec4(fill.rgb * fill.a, fill.a) * cover;
    float edge = (body - clamp(-0.5 - d, 0.0, 1.0)) * u_border.a;
    color = vec4(u_border.rgb, 1.0) * edge + color * (1.0 - edge);
}
cogl_color_out = color * cogl_color_in.a;
`;

/** What the notch hands the shader each frame, in the actor's pixels. */
export interface ShapeGeometry {
    /** The actor's size. */
    width: number;
    height: number;
    /** The body's centre, its width and height. */
    center: number;
    bodyWidth: number;
    bodyHeight: number;
    earRadius: number;
    cornerRadius: number;
}

/** 0..1 red, green, blue and alpha. */
export type Rgba = [number, number, number, number];

export interface ShapeColors {
    top: Rgba;
    bottom: Rgba;
    border: Rgba;
    /** The way from `top` to `bottom`, a unit vector; down when missing. */
    direction?: [number, number];
}

/** Sets a uniform on whichever effect class this shell has. */
type SetUniform = (effect: Clutter.Effect, name: string, values: number[]) => void;

interface ShaderClass {
    create(): Clutter.Effect;
    set: SetUniform;
}

let shaderClass: ShaderClass | null = null;

/**
 * The effect class, registered on first use. GNOME 46 to 50 have
 * Shell.GLSLEffect (46 names the hook Shell.SnippetHook, 48 Cogl.SnippetHook);
 * GNOME 51 dropped it for Clutter.ShaderEffect with a static snippet.
 */
function shader(): ShaderClass {
    if (shaderClass) return shaderClass;
    const shell = Shell as unknown as { GLSLEffect?: typeof Shell.GLSLEffect; SnippetHook?: { FRAGMENT: number } };
    const cogl = Cogl as unknown as {
        SnippetHook?: { FRAGMENT: number };
        Snippet: { new: (hook: number, declarations: string, code: string | null) => { set_replace(code: string): void } };
    };
    if (shell.GLSLEffect) {
        const hook = shell.SnippetHook?.FRAGMENT ?? cogl.SnippetHook!.FRAGMENT;
        const Effect = GObject.registerClass(
            { GTypeName: 'NoktaShapeEffect' },
            class extends shell.GLSLEffect {
                override vfunc_build_pipeline(): void {
                    this.add_glsl_snippet(hook as Shell.SnippetHook, DECLARATIONS, CODE, true);
                }
            },
        );
        const locations = new Map<string, number>();
        shaderClass = {
            create: () => new Effect(),
            set: (effect, name, values) => {
                const glsl = effect as Shell.GLSLEffect;
                let location = locations.get(name);
                if (location === undefined) {
                    location = glsl.get_uniform_location(name);
                    locations.set(name, location);
                }
                glsl.set_uniform_float(location, values.length, values);
            },
        };
    } else {
        const Effect = GObject.registerClass(
            { GTypeName: 'NoktaShapeEffect' },
            class extends Clutter.ShaderEffect {
                vfunc_get_static_snippet(): unknown {
                    const snippet = cogl.Snippet.new(cogl.SnippetHook!.FRAGMENT, DECLARATIONS, null);
                    snippet.set_replace(CODE);
                    return snippet;
                }
            },
        );
        shaderClass = {
            create: () => new Effect(),
            set: (effect, name, values) => {
                const shaderEffect = effect as unknown as { set_uniform_float(n: string, c: number, v: number[]): void };
                shaderEffect.set_uniform_float(name, values.length, values);
            },
        };
    }
    return shaderClass;
}

/** The silhouette or the glow on `actor`, which it fills; the actor paints nothing else. */
export class Shape {
    private readonly effect: Clutter.Effect;
    private readonly set: SetUniform;

    constructor(
        private readonly actor: Clutter.Actor,
        glow: boolean,
    ) {
        const { create, set } = shader();
        this.effect = create();
        this.set = set;
        actor.add_effect(this.effect);
        this.uniform('u_glow', [glow ? 1 : 0]);
    }

    setGeometry(g: ShapeGeometry): void {
        this.uniform('u_size', [g.width, g.height]);
        this.uniform('u_center', [g.center]);
        this.uniform('u_half', [g.bodyWidth / 2, g.bodyHeight]);
        this.uniform('u_ear', [g.earRadius]);
        this.uniform('u_radius', [g.cornerRadius]);
        this.repaint();
    }

    /** The glow takes its colour from `top`. */
    setColors(c: ShapeColors): void {
        this.uniform('u_top', c.top);
        this.uniform('u_bottom', c.bottom);
        this.uniform('u_border', c.border);
        this.uniform('u_direction', c.direction ?? [0, 1]);
        this.repaint();
    }

    /** Draws the shape again from the uniforms, without painting the actor offscreen again. */
    private repaint(): void {
        if (this.actor.get_stage()) this.effect.queue_repaint();
    }

    private uniform(name: string, values: number[]): void {
        this.set(this.effect, name, values);
    }
}
