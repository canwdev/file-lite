<template>
  <div class="page-404">
    <h2>{{ $t('file_lite_i18n.n_404_page_not_found') }}</h2>
    <p>{{ $t('file_lite_i18n.sorry_the_page_you_are_looking_f') }}</p>
    <RouterLink to="/">
      {{ $t('file_lite_i18n.home') }}
    </RouterLink>
  </div>
</template>

<style scoped>
.page-404 {
  padding: 20px;
}
</style>
