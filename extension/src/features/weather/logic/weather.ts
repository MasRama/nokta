/** What the idle panel shows next to the date. */
export interface WeatherLine {
    icon: string;
    /** Like `31°`. */
    temperature: string;
    /** The place and today's high and low, like `Jakarta · 33° / 25°`. */
    detail: string;
}

const ICONS: Record<string, readonly [day: string, night: string]> = {
    clear: ['weather-clear-symbolic', 'weather-clear-night-symbolic'],
    'partly-cloudy': ['weather-few-clouds-symbolic', 'weather-few-clouds-night-symbolic'],
    cloudy: ['weather-overcast-symbolic', 'weather-overcast-symbolic'],
    fog: ['weather-fog-symbolic', 'weather-fog-symbolic'],
    drizzle: ['weather-showers-scattered-symbolic', 'weather-showers-scattered-symbolic'],
    rain: ['weather-showers-symbolic', 'weather-showers-symbolic'],
    showers: ['weather-showers-symbolic', 'weather-showers-symbolic'],
    snow: ['weather-snow-symbolic', 'weather-snow-symbolic'],
    thunderstorm: ['weather-storm-symbolic', 'weather-storm-symbolic'],
};

/** The icon for an io.nokta.Weather1.Condition; overcast for one this version does not know. */
export function weatherIcon(condition: string, isDay: boolean): string {
    const [day, night] = ICONS[condition] ?? ICONS.cloudy;
    return isDay ? day : night;
}

/** A temperature in whole degrees, like `31°`. */
export function weatherText(degrees: number): string {
    // `|| 0` turns -0 into 0.
    return `${Math.round(degrees) || 0}°`;
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** The panel line from the io.nokta.Weather1 properties, or null unless they hold a ready reading. */
export function weatherLine(props: Readonly<Record<string, unknown>>): WeatherLine | null {
    const { Status, Place, Temperature, High, Low, Condition, IsDay } = props;
    if (Status !== 'ready' || !isNumber(Temperature) || !isNumber(High) || !isNumber(Low)) return null;
    const range = `${weatherText(High)} / ${weatherText(Low)}`;
    const place = typeof Place === 'string' ? Place : '';
    return {
        icon: weatherIcon(typeof Condition === 'string' ? Condition : '', IsDay !== false),
        temperature: weatherText(Temperature),
        detail: place ? `${place} · ${range}` : range,
    };
}
