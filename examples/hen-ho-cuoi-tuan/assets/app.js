(() => {
  const choices = [...document.querySelectorAll('.choice')];
  const confirmButton = document.querySelector('#confirm');
  const picker = document.querySelector('#picker');
  const thanks = document.querySelector('#thanks');
  const chosenDate = document.querySelector('#chosen-date');
  const loveMessage = document.querySelector('#love-message');
  const selected = new Map();

  const mondayOf = (date) => {
    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
    return day;
  };
  const friday = mondayOf(new Date());
  friday.setDate(friday.getDate() + 4);
  const saturday = new Date(friday);
  saturday.setDate(saturday.getDate() + 1);
  const prettyDate = (date) => new Intl.DateTimeFormat('vi-VN', { day: 'numeric', month: 'long' }).format(date);
  const prettyWeekday = (date) => new Intl.DateTimeFormat('vi-VN', { weekday: 'long' }).format(date);
  const dates = { friday, saturday };

  for (const key of Object.keys(dates)) {
    const date = dates[key];
    document.querySelector(`[data-date="${key}-name"]`).textContent = prettyWeekday(date).replace(/^./, (c) => c.toLocaleUpperCase('vi-VN'));
    document.querySelector(`[data-date="${key}-date"]`).textContent = prettyDate(date);
  }

  choices.forEach((button) => {
    button.addEventListener('click', () => {
      choices.forEach((choice) => {
        const active = choice === button;
        choice.setAttribute('aria-checked', String(active));
        choice.tabIndex = active ? 0 : -1;
      });
      selected.set('day', button.dataset.day);
      confirmButton.disabled = false;
      document.querySelector('#choice-help').textContent = `Em chọn ${prettyWeekday(dates[button.dataset.day])} rồi nè ♡`;
    });
  });

  confirmButton.addEventListener('click', () => {
    const day = selected.get('day');
    if (!day) return;
    const date = dates[day];
    const weekday = prettyWeekday(date);
    const fullDate = `${weekday}, ${prettyDate(date)}`;
    chosenDate.textContent = `Hẹn em ${fullDate} nha!`;
    loveMessage.textContent = `Cảm ơn em đã chọn dành thời gian đi date cùng anh. Anh vui lắm vì cuối tuần này tụi mình có một buổi hẹn riêng — cùng ăn món ngon, kể nhau nghe chuyện bé xíu, rồi tạo thêm một kỷ niệm thật đáng yêu. Anh thương em nhiều thật nhiều! ♡`;
    picker.hidden = true;
    thanks.hidden = false;
    thanks.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  document.querySelector('#edit-choice').addEventListener('click', () => {
    thanks.hidden = true;
    picker.hidden = false;
    picker.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  document.querySelector('#share-message').addEventListener('click', async (event) => {
    const text = `${chosenDate.textContent}\n\n${loveMessage.textContent}\n\nAnh sẽ đợi em chọn địa điểm nha. Thương em nhiều! ♡`;
    try {
      if (navigator.share) await navigator.share({ title: 'Mình đi date nha? ♡', text });
      else {
        await navigator.clipboard.writeText(text);
        event.currentTarget.innerHTML = 'Đã chép lời nhắn <span aria-hidden="true">♡</span>';
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      try {
        await navigator.clipboard.writeText(text);
        event.currentTarget.innerHTML = 'Đã chép lời nhắn <span aria-hidden="true">♡</span>';
      } catch {
        event.currentTarget.textContent = 'Hãy chọn và sao chép lời nhắn phía trên nhé';
      }
    }
  });
})();
