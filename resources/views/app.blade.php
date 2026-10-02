<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Sinag-Bughaw | NU Lipa Digital Yearbook</title>
    <link rel="icon" type="image/png" href="/images/NU_logo.png" />
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
    @php
      $spaJs = collect(glob(public_path('assets/index-*.js')))->sortBy(fn ($f) => filemtime($f))->last();
      $spaCss = collect(glob(public_path('assets/index-*.css')))->sortBy(fn ($f) => filemtime($f))->last();
      $viteHot = file_exists(public_path('hot'))
        ? trim(file_get_contents(public_path('hot')))
        : null;
    @endphp
    @if ($viteHot)
      <script type="module" src="{{ $viteHot }}/@vite/client"></script>
      <script type="module" src="{{ $viteHot }}/src/main.jsx"></script>
    @elseif ($spaJs && $spaCss)
      <script type="module" crossorigin src="/assets/{{ basename($spaJs) }}"></script>
      <link rel="stylesheet" crossorigin href="/assets/{{ basename($spaCss) }}">
    @elseif (app()->environment(['local', 'development']))
      {{-- Dev fallback when Vite is running on 5173 without a hot file --}}
      <script type="module" src="http://localhost:5173/@vite/client"></script>
      <script type="module" src="http://localhost:5173/src/main.jsx"></script>
    @else
      <p style="font-family:system-ui;padding:2rem;text-align:center">
        Application assets are missing. Run <code>npm run build</code> and deploy the <code>public/assets</code> folder.
      </p>
    @endif
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
