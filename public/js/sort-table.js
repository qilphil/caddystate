(function () {
  document.querySelectorAll('table.sortable').forEach(function (table) {
    var headers = table.querySelectorAll('thead th');
    var tbody = table.querySelector('tbody');
    var sortCol = -1;
    var sortAsc = true;

    headers.forEach(function (th, col) {
      if (th.hasAttribute('data-nosort')) return;
      th.classList.add('sort-col');
      th.addEventListener('click', function () {
        if (sortCol === col) {
          sortAsc = !sortAsc;
        } else {
          sortCol = col;
          sortAsc = true;
        }
        headers.forEach(function (h) {
          h.removeAttribute('data-sort-dir');
        });
        th.setAttribute('data-sort-dir', sortAsc ? 'asc' : 'desc');

        var rows = Array.from(tbody.querySelectorAll('tr'));
        rows.sort(function (a, b) {
          var aText = a.cells[col] ? a.cells[col].textContent.trim() : '';
          var bText = b.cells[col] ? b.cells[col].textContent.trim() : '';
          var aNum = parseFloat(aText);
          var bNum = parseFloat(bText);
          if (!isNaN(aNum) && !isNaN(bNum)) {
            return sortAsc ? aNum - bNum : bNum - aNum;
          }
          return sortAsc ? aText.localeCompare(bText) : bText.localeCompare(aText);
        });
        rows.forEach(function (row) { tbody.appendChild(row); });
      });
    });
  });
}());
