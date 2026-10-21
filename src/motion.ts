import { Easing, cubicBezier, type CSSTransitionProperties } from 'react-native-reanimated';

/**
 * The app's motion vocabulary, in one place so every animation agrees.
 *
 * Reanimated wants two spellings of the same curve: `cubicBezier` for CSS
 * transitions in a style, `Easing.bezier` for `withTiming` and layout
 * animation builders.
 */

/** Strong ease-out: starts fast, so the change lands while the user is still looking. */
export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
export const CSS_EASE_OUT = cubicBezier(0.23, 1, 0.32, 1);

/**
 * A Reanimated CSS transition for `properties`.
 *
 * Kept out of `StyleSheet.create`: React Native 0.86 types its own
 * `transition*` keys, which reject Reanimated's numeric durations and easing
 * objects. Spread it into an `Animated.*` style array instead.
 */
export function transition(
  properties: string | string[],
  durationMs: number
): CSSTransitionProperties {
  return {
    transitionProperty: properties,
    transitionDuration: durationMs,
    transitionTimingFunction: CSS_EASE_OUT,
  } as CSSTransitionProperties;
}

/**
 * Selectable chips: the press dip plus a crossfade of the fill, so picking one
 * eases the colour across instead of snapping it. Pass the first to
 * `PressableScale`'s `pressTransition`, the second to the label's style.
 */
export const CHIP_TRANSITION = transition(
  ['transform', 'opacity', 'backgroundColor', 'borderColor'],
  160
);
export const CHIP_TEXT_TRANSITION = transition('color', 160);
