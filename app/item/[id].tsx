import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet } from 'react-native';

import { Text, View, useThemeColor } from '@/components/Themed';
import TagEditor, { DEFAULT_TAGS } from '@/src/components/TagEditor';
import { useAppState } from '@/src/store';
import type { ClosetItem, ItemTags } from '@/src/types';

/** Shown for a `failed` item whose in-memory error was lost to a restart. */
const STALE_FAILURE_MESSAGE = 'Tagging failed earlier. Tap Retag to try again.';

const RETAG_LABEL: Record<ClosetItem['tagStatus'], string> = {
  pending: 'Tag with AI',
  tagging: 'Tagging…',
  tagged: 'Retag',
  failed: 'Retag',
};

export default function ItemDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { closet, removeItem, updateItem, tagItem, tagErrors } = useAppState();
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const tint = useThemeColor({}, 'tint');

  const item = closet.find((candidate) => candidate.id === id);
  const tagError = item ? tagErrors[item.id] : undefined;

  const confirmDelete = useCallback(() => {
    if (!item || deleting) return;
    Alert.alert('Delete item?', 'This removes the photo from your closet. It cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          // Set before removing so the screen shows a blank frame rather than
          // flashing "not found" while the modal dismisses.
          setDeleting(true);
          removeItem(item.id);
          router.back();
        },
      },
    ]);
  }, [item, deleting, removeItem, router]);

  // Every keystroke / chip tap writes through the store, which persists it —
  // there is no Save button to miss on the way out of the modal.
  const handleTagsChange = useCallback(
    (tags: ItemTags) => {
      if (!item) return;
      updateItem(item.id, { tags, tagStatus: 'tagged' });
    },
    [item, updateItem]
  );

  const startManualTagging = useCallback(() => {
    if (!item) return;
    updateItem(item.id, { tags: item.tags ?? DEFAULT_TAGS, tagStatus: 'tagged' });
    setEditing(true);
  }, [item, updateItem]);

  const retag = useCallback(() => {
    if (!item || item.tagStatus === 'tagging') return;
    tagItem(item.id);
  }, [item, tagItem]);

  if (!item) {
    return (
      <View style={styles.container}>
        {!deleting ? (
          <>
            <Text style={styles.title}>Item not found</Text>
            <Text style={styles.subtitle}>It may have been deleted.</Text>
          </>
        ) : null}
        <StatusBar style={Platform.OS === 'ios' ? 'light' : 'auto'} />
      </View>
    );
  }

  const statusNote =
    item.tagStatus === 'failed'
      ? (tagError ?? STALE_FAILURE_MESSAGE)
      : item.tagStatus === 'pending'
        ? (tagError ?? 'Waiting to be tagged.')
        : undefined;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: itemTitle(item) }} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets>
        <Image
          source={{ uri: item.photoUri }}
          style={styles.photo}
          contentFit="contain"
          transition={120}
        />

        <View style={styles.statusRow}>
          {item.tagStatus === 'tagging' ? <ActivityIndicator size="small" /> : null}
          <Text style={styles.subtitle}>
            Added {new Date(item.createdAt).toLocaleDateString()}
            {item.tagStatus === 'tagging' ? ' · Tagging…' : ''}
          </Text>
        </View>

        {statusNote ? <Text style={styles.note}>{statusNote}</Text> : null}

        {item.tags ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Tags</Text>
              <Pressable
                onPress={() => setEditing((previous) => !previous)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.link, { opacity: pressed ? 0.6 : 1 }]}>
                <Text style={[styles.linkText, { color: tint }]}>{editing ? 'Done' : 'Edit'}</Text>
              </Pressable>
            </View>

            {editing ? (
              <TagEditor tags={item.tags} onChange={handleTagsChange} />
            ) : (
              <TagSummary tags={item.tags} />
            )}
          </View>
        ) : (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>No tags yet</Text>
            <Pressable
              onPress={startManualTagging}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.outlineButton,
                { borderColor: tint, opacity: pressed ? 0.6 : 1 },
              ]}>
              <Text style={[styles.outlineButtonText, { color: tint }]}>Add tags manually</Text>
            </Pressable>
          </View>
        )}

        <Pressable
          onPress={retag}
          disabled={item.tagStatus === 'tagging'}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.outlineButton,
            {
              borderColor: tint,
              opacity: item.tagStatus === 'tagging' ? 0.4 : pressed ? 0.6 : 1,
            },
          ]}>
          <Text style={[styles.outlineButtonText, { color: tint }]}>
            {RETAG_LABEL[item.tagStatus]}
          </Text>
        </Pressable>

        <Pressable
          onPress={confirmDelete}
          accessibilityRole="button"
          style={({ pressed }) => [styles.deleteButton, { opacity: pressed ? 0.6 : 1 }]}>
          <Text style={styles.deleteText}>Delete item</Text>
        </Pressable>

        {/* Use a light status bar on iOS to account for the black space above the modal */}
        <StatusBar style={Platform.OS === 'ios' ? 'light' : 'auto'} />
      </ScrollView>
    </View>
  );
}

function TagSummary({ tags }: { tags: ItemTags }) {
  const rows: [string, string][] = [
    ['Category', capitalise(tags.category)],
    ['Colour', tags.color.trim().length > 0 ? tags.color : 'unknown'],
    ['Warmth', `${tags.warmth} / 5`],
    ['Formality', capitalise(tags.formality)],
    ['Rainproof', tags.rainproof ? 'Yes' : 'No'],
    ['Seasons', tags.season.map(capitalise).join(', ')],
  ];

  return (
    <View style={styles.summary}>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>{label}</Text>
          <Text style={styles.summaryValue}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

/** Header title like "Navy Top"; falls back to "Item" until tags exist. */
function itemTitle(item: ClosetItem): string {
  if (!item.tags) return 'Item';
  const color = item.tags.color.trim();
  const category = capitalise(item.tags.category);
  return color.length > 0 ? `${capitalise(color)} ${category}` : category;
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 48,
    gap: 4,
  },
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  photo: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 12,
    backgroundColor: 'rgba(127,127,127,0.12)',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingTop: 14,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  subtitle: {
    fontSize: 14,
    opacity: 0.6,
    marginTop: 4,
  },
  note: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    color: '#d0342c',
  },
  section: {
    marginTop: 24,
    gap: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  link: {
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  linkText: {
    fontSize: 15,
    fontWeight: '600',
  },
  summary: {
    gap: 8,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 16,
  },
  summaryLabel: {
    fontSize: 15,
    opacity: 0.6,
  },
  summaryValue: {
    fontSize: 15,
    fontWeight: '600',
    flexShrink: 1,
    textAlign: 'right',
  },
  outlineButton: {
    marginTop: 24,
    alignSelf: 'center',
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 999,
    borderWidth: 1,
  },
  outlineButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  deleteButton: {
    marginTop: 8,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  deleteText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#d0342c',
  },
});
