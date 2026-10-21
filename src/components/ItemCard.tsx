import { Image } from 'expo-image';
import { StyleSheet } from 'react-native';
import Animated, { FadeOut } from 'react-native-reanimated';

import { Text } from '@/components/Themed';
import PressableScale from '@/src/components/PressableScale';
import { EASE_OUT } from '@/src/motion';
import type { ClosetItem } from '@/src/types';

const STATUS_LABEL: Record<ClosetItem['tagStatus'], string> = {
  pending: 'Pending',
  tagging: 'Tagging…',
  tagged: 'Tagged',
  failed: 'Failed',
};

const STATUS_COLOR: Record<ClosetItem['tagStatus'], string> = {
  pending: 'rgba(60,60,67,0.75)',
  tagging: 'rgba(47,149,220,0.9)',
  tagged: 'rgba(52,164,90,0.9)',
  failed: 'rgba(200,60,55,0.9)',
};

// Exit only: the badge going away is the news ("Tagging…" → done). An
// entrance would replay every time the grid scrolled a row back into view.
const BADGE_EXITING = FadeOut.duration(200).easing(EASE_OUT);

export default function ItemCard({
  item,
  size,
  onPress,
}: {
  item: ClosetItem;
  size: number;
  onPress: (item: ClosetItem) => void;
}) {
  return (
    <PressableScale
      onPress={() => onPress(item)}
      style={[styles.card, { width: size, height: size }]}
      accessibilityRole="button"
      accessibilityLabel={`Clothing item, ${STATUS_LABEL[item.tagStatus]}`}>
      <Image
        source={{ uri: item.photoUri }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        recyclingKey={item.id}
        transition={120}
      />
      {item.tagStatus !== 'tagged' ? (
        <Animated.View
          exiting={BADGE_EXITING}
          style={[styles.badge, { backgroundColor: STATUS_COLOR[item.tagStatus] }]}>
          <Text style={styles.badgeText} lightColor="#fff" darkColor="#fff">
            {STATUS_LABEL[item.tagStatus]}
          </Text>
        </Animated.View>
      ) : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: 'rgba(127,127,127,0.15)',
  },
  badge: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
});
