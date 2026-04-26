<script lang="ts">
  let {
    onOpenWiki: _onOpenWiki = () => {},
    onOpenEmail: _onOpenEmail = () => {},
    onClose: _onClose = () => {},
  }: {
    onOpenWiki?: (_path: string) => void
    onOpenEmail?: (_id: string, _subject: string, _from: string) => void
    onClose?: () => void
  } = $props()
</script>

<div data-testid="search-stub" class="search-stub">Search</div>
