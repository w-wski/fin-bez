# Model języka polskiego dla rozpoznawania tekstu (OCR)

`pol.traineddata.gz` — wytrenowany model języka polskiego dla Tesseracta, wariant LSTM
(`4.0.0_best_int`, 2,6 MB). Pobrany z `@tesseract.js-data/pol`, oryginalnie z projektu
`tesseract-ocr/tessdata`, licencja **Apache-2.0**.

## Dlaczego leży w repozytorium, a nie pobiera się sam

Bo brak tego pliku **kładł całą aplikację**. Tesseract.js, gdy nie znajdzie modelu, rzuca
wyjątek wewnątrz nasłuchu zdarzeń — nikt go tam nie łapie i ginie cały proces Node.
Na produkcji (Passenger) objawiało się to odpowiedzią **503** przy każdym wgraniu paragonu,
także zdjęcia z aparatu, i zrywało wszystkie inne żądania obsługiwane w tym samym momencie.

Pobieranie w locie z sieci byłoby drugą taką pułapką: shared hosting nie musi mieć wyjścia
na zewnątrz, a pierwszy paragon nie jest dobrym momentem, żeby się o tym dowiedzieć.
2,6 MB w gicie to tania cena za wdrożenie, które nie ma ruchomych części.

Osłony w `src/ocr/worker.js` (sprawdzenie pliku, `errorHandler`, budzik na starcie) zostają
mimo obecności modelu — chronią przed plikiem obciętym w transporcie.
`scripts/test-ocr-worker.js` pilnuje, żeby ten plik nie zniknął z wdrożenia niepostrzeżenie.

## Skąd wziąć go ponownie

    curl -sSL -o pol.traineddata.gz \
      https://cdn.jsdelivr.net/npm/@tesseract.js-data/pol/4.0.0_best_int/pol.traineddata.gz
