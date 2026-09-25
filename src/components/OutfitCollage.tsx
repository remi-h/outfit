import { Image } from 'expo-image';
import { StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import type { ClosetItem } from '@/src/types';

/**
 * The outfit for one day, drawn as a grid of the user's own photos.
 *
 * Every ID is resolved **through the closet map**; an ID with no matching item
 * is skipped silently. Deleting a closet item already strips it from stored
 * plans (`removeItem` in `src/store.tsx`), so this is the second line of
 * defence: a plan that was in flight while an item was deleted, an older blob
 * from AsyncStorage, or a model answer that slipped past validation can never
 * put a broken tile — or a crash — on screen.
 */

/** Past this many tiles the row wraps twice and the card gets tall; show "+N". */
const MAX_TILES = 6;

const DEFAULT_TILE = 76;

/**
 * The plan's IDs, in order, as closet items. Unknown IDs and repeats are
 * dropped. Exported because `DayCard` needs the *resolved* count to decide
 * whether a day has fewer than two items, and counting `itemIds` would count
 * the dead ones too.
 */
export function resolveOutfitItems(
  itemIds: readonly string[] | undefined,
  itemsById: ReadonlyMap<string, ClosetItem>
): ClosetItem[] {
  if (!Array.isArray(itemIds)) return [];

  const items: ClosetItem[] = [];
  const seen = new Set<string>();
  for (const id of itemIds) {
    if (typeof id !== 'string' || seen.has(id)) continue;
    seen.add(id);
    const item = itemsById.get(id);
    // The whole point of this function: no item, no tile, no crash.
    if (item) items.push(item);
  }
  return items;
}

/** "navy top" — what VoiceOver reads for a tile. */
function describe(item: ClosetItem): string {
  if (!item.tags) return 'Clothing item';
  return `${item.tags.color} ${item.tags.category}`;
}

export default function OutfitCollage({
  itemIds,
  itemsById,
  tileSize = DEFAULT_TILE,
}: {
  itemIds: readonly string[] | undefined;
  itemsById: ReadonlyMap<string, ClosetItem>;
  tileSize?: number;
}) {
  const items = resolveOutfitItems(itemIds, itemsById);
  if (items.length === 0) return null;

  const shown = items.slice(0, MAX_TILES);
  const hidden = items.length - shown.length;

  return (
    <View style={styles.grid} accessibilityRole="list">
      {shown.map((item) => (
        <View
          key={item.id}
          style={[styles.tile, { width: tileSize, height: tileSize }]}
          accessibilityLabel={describe(item)}>
          <Image
            source={{ uri: item.photoUri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            recyclingKey={item.id}
            transition={120}
          />
        </View>
      ))}

      {hidden > 0 ? (
        <View
          style={[styles.tile, styles.more, { width: tileSize, height: tileSize }]}
          lightColor="rgba(127,127,127,0.15)"
          darkColor="rgba(127,127,127,0.25)">
          <Text style={styles.moreText}>{`+${hidden}`}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tile: {
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: 'rgba(127,127,127,0.15)',
  },
  more: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreText: {
    fontSize: 15,
    fontWeight: '600',
    opacity: 0.7,
  },
});
