import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeftIcon } from 'lucide-react-native';
import { api } from '@/lib/api';
import { FontFamily, FontSize, Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import type { SocraticMessage, SocraticThread } from '@/types/api';

function MessageBlock({ message }: { message: SocraticMessage }) {
  const c = useThemeColors();
  const isUser = message.role === 'USER';

  if (isUser) {
    return (
      <View style={styles.userRow}>
        <View style={[styles.userBubble, { backgroundColor: c.elevated, borderColor: c.border }]}>
          <Text
            variant="monoSmall"
            style={{ color: c.text, lineHeight: 20 }}
          >
            {message.content}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.companionRow, { borderLeftColor: c.border }]}>
      <Text variant="monoSmall" style={{ color: c.faint, marginBottom: Spacing[2], letterSpacing: 2 }}>
        MNEME
      </Text>
      <Text variant="serif" color="secondary" style={{ lineHeight: 26 }}>
        {message.content}
      </Text>
    </View>
  );
}

export default function SocraticScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { topicId } = useLocalSearchParams<{ topicId: string }>();

  const [thread, setThread] = useState<SocraticThread | null>(null);
  const [messages, setMessages] = useState<SocraticMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const scrollRef = useRef<ScrollView>(null);

  const scrollToEnd = useCallback((animated = true) => {
    scrollRef.current?.scrollToEnd({ animated });
  }, []);

  useEffect(() => {
    if (!topicId) return;
    void (async () => {
      try {
        const data = await api.socratic.getThread(topicId);
        setThread(data);
        setMessages(data.messages);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load thread');
      } finally {
        setLoading(false);
      }
    })();
  }, [topicId]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => scrollToEnd(false), 100);
    }
  }, [messages.length, scrollToEnd]);

  const handleSend = useCallback(async () => {
    const content = reply.trim();
    if (!content || sending || !topicId) return;

    const optimisticUser: SocraticMessage = {
      id: `optimistic-${Date.now()}`,
      threadId: thread?.id ?? '',
      role: 'USER',
      content,
      createdAt: new Date().toISOString(),
    };

    setReply('');
    setSending(true);
    setMessages((prev) => [...prev, optimisticUser]);

    try {
      const { userMessage, companionMessage } = await api.socratic.reply(topicId, content);
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimisticUser.id),
        userMessage,
        companionMessage,
      ]);
    } catch (e) {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticUser.id));
      setError(e instanceof Error ? e.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  }, [reply, sending, topicId, thread?.id]);

  const topicName = thread?.topic.name ?? '';

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backButton} accessibilityLabel="Back">
          <ChevronLeftIcon size={22} color={c.text} />
        </Pressable>
        <Text variant="monoSmall" color="muted" style={styles.headerTitle} numberOfLines={1}>
          dialogue{topicName ? ` · ${topicName.toLowerCase()}` : ''}
        </Text>
        <View style={{ width: 30 }} />
      </View>

      {loading && (
        <View style={styles.centered}>
          <ActivityIndicator color={c.text} />
        </View>
      )}

      {!loading && error && (
        <View style={styles.centered}>
          <Text variant="monoSmall" color="danger">{error}</Text>
        </View>
      )}

      {!loading && !error && (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
          <ScrollView
            ref={scrollRef}
            style={styles.flex}
            contentContainerStyle={[
              styles.messageList,
              messages.length === 0 && styles.messageListEmpty,
            ]}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => scrollToEnd(false)}
          >
            {messages.length === 0 ? (
              <Text
                variant="serif"
                color="secondary"
                style={{ fontStyle: 'italic', textAlign: 'center' }}
              >
                The dialogue begins when you respond.
              </Text>
            ) : (
              messages.map((msg) => <MessageBlock key={msg.id} message={msg} />)
            )}
            {sending && (
              <View style={[styles.companionRow, { borderLeftColor: c.border }]}>
                <Text variant="monoSmall" style={{ color: c.faint, marginBottom: Spacing[2], letterSpacing: 2 }}>
                  MNEME
                </Text>
                <Text variant="monoSmall" color="muted" style={{ letterSpacing: 3 }}>
                  · · ·
                </Text>
              </View>
            )}
          </ScrollView>

          <View
            style={[
              styles.inputBar,
              {
                borderTopColor: c.border,
                backgroundColor: c.background,
                paddingBottom: Math.max(insets.bottom, Spacing[3]),
              },
            ]}
          >
            <TextInput
              style={[styles.textInput, { color: c.text, fontFamily: FontFamily.mono, fontSize: FontSize.sm }]}
              value={reply}
              onChangeText={setReply}
              placeholder="reply..."
              placeholderTextColor={c.faint}
              multiline
              maxLength={4000}
              editable={!sending}
              onSubmitEditing={handleSend}
              blurOnSubmit={false}
            />
            <Pressable
              onPress={handleSend}
              disabled={!reply.trim() || sending}
              style={styles.sendButton}
              accessibilityLabel="Send"
              accessibilityRole="button"
            >
              <Text
                variant="monoSmall"
                style={{ color: reply.trim() && !sending ? c.text : c.faint, fontSize: FontSize.base }}
              >
                →
              </Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
    borderBottomWidth: 1,
  },
  backButton: { padding: Spacing[1] },
  headerTitle: { flex: 1, textAlign: 'center', letterSpacing: 0.5 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageList: {
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[8],
    gap: Spacing[8],
  },
  messageListEmpty: {
    flex: 1,
    justifyContent: 'center',
  },
  companionRow: {
    borderLeftWidth: 2,
    paddingLeft: Spacing[4],
  },
  userRow: {
    alignItems: 'flex-end',
  },
  userBubble: {
    maxWidth: '82%',
    borderRadius: Radius.sm,
    borderWidth: 1,
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: Spacing[5],
    paddingTop: Spacing[3],
    borderTopWidth: 1,
    gap: Spacing[3],
  },
  textInput: {
    flex: 1,
    paddingVertical: Spacing[2],
    maxHeight: 120,
    lineHeight: 20,
  },
  sendButton: {
    paddingVertical: Spacing[2],
    paddingHorizontal: Spacing[2],
    marginBottom: 2,
  },
});
