<?php
/**
 * A minimal, dependency-free .xlsx reader — reads the first sheet of a
 * single-sheet workbook and returns rows as plain arrays of strings.
 * Handles both inline strings (what xlsx_writer.php produces) and the
 * shared-string table real Excel/Google Sheets/LibreOffice use when they
 * save a file — so an exported file that gets edited and re-uploaded still
 * reads correctly either way.
 *
 * Returns ['headers' => [...], 'rows' => [ [col => value, ...], ... ]]
 * or throws a RuntimeException with a human-readable message on failure.
 */

function xlsx_col_to_index(string $colLetters): int {
    $index = 0;
    foreach (str_split($colLetters) as $char) {
        $index = $index * 26 + (ord($char) - 64);
    }
    return $index - 1; // 0-based
}

function xlsx_read(string $filePath): array {
    $zip = new ZipArchive();
    if ($zip->open($filePath) !== true) {
        throw new RuntimeException('That file is not a valid .xlsx (could not open it as a zip archive).');
    }

    // Shared strings (optional — not every workbook has one)
    $sharedStrings = [];
    $sharedXml = $zip->getFromName('xl/sharedStrings.xml');
    if ($sharedXml !== false) {
        $dom = new DOMDocument();
        $dom->loadXML($sharedXml);
        foreach ($dom->getElementsByTagName('si') as $si) {
            // Concatenate all <t> text runs inside this <si> (handles both
            // a plain <t> and rich text split across multiple <r><t> runs).
            $text = '';
            foreach ($si->getElementsByTagName('t') as $t) $text .= $t->textContent;
            $sharedStrings[] = $text;
        }
    }

    // Find the first worksheet. Real workbooks name it via workbook.xml.rels;
    // our own writer and the overwhelming majority of simple exports use
    // xl/worksheets/sheet1.xml directly, so that's the one documented
    // limitation here: only the FIRST sheet of a multi-sheet file is read.
    $sheetXml = $zip->getFromName('xl/worksheets/sheet1.xml');
    if ($sheetXml === false) {
        throw new RuntimeException('Could not find a worksheet inside that file (expected a single-sheet workbook).');
    }
    $zip->close();

    $dom = new DOMDocument();
    $dom->loadXML($sheetXml);

    $grid = []; // [rowNum][colIndex] => string value
    $maxCol = 0;
    foreach ($dom->getElementsByTagName('row') as $rowEl) {
        $rowNum = (int)$rowEl->getAttribute('r');
        foreach ($rowEl->getElementsByTagName('c') as $cellEl) {
            $ref = $cellEl->getAttribute('r'); // e.g. "C7"
            preg_match('/^([A-Z]+)(\d+)$/', $ref, $m);
            $colIndex = $m ? xlsx_col_to_index($m[1]) : 0;
            $maxCol = max($maxCol, $colIndex);

            $type = $cellEl->getAttribute('t');
            $value = '';
            if ($type === 'inlineStr') {
                $isEl = $cellEl->getElementsByTagName('is')->item(0);
                if ($isEl) foreach ($isEl->getElementsByTagName('t') as $t) $value .= $t->textContent;
            } else {
                $vEl = $cellEl->getElementsByTagName('v')->item(0);
                $raw = $vEl ? $vEl->textContent : '';
                if ($type === 's') { // shared-string index
                    $value = $sharedStrings[(int)$raw] ?? '';
                } else {
                    $value = $raw; // number, or untyped (also a number)
                }
            }
            $grid[$rowNum][$colIndex] = $value;
        }
    }

    if (empty($grid)) throw new RuntimeException('That spreadsheet appears to be empty.');

    $rowNums = array_keys($grid);
    sort($rowNums);
    $headerRowNum = $rowNums[0];
    $headers = [];
    for ($c = 0; $c <= $maxCol; $c++) {
        $headers[] = trim($grid[$headerRowNum][$c] ?? '');
    }

    $rows = [];
    foreach ($rowNums as $rowNum) {
        if ($rowNum === $headerRowNum) continue;
        $assoc = [];
        $hasAnyValue = false;
        for ($c = 0; $c <= $maxCol; $c++) {
            $key = $headers[$c] !== '' ? $headers[$c] : "col$c";
            $val = $grid[$rowNum][$c] ?? '';
            if ($val !== '') $hasAnyValue = true;
            $assoc[$key] = $val;
        }
        if ($hasAnyValue) $rows[] = $assoc; // skip fully blank rows
    }

    return ['headers' => $headers, 'rows' => $rows];
}
