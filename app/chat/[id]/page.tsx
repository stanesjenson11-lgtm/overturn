import Conversation from "@/components/Conversation";

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // The id is not trusted here — /api/chats/[id] scopes it to the session, so an
  // id belonging to someone else renders an error, not their conversation.
  return <Conversation chatId={id} />;
}
