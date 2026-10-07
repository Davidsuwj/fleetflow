from backend.db import migrate

def bootstrap():
    migrate()

if __name__ == '__main__':
    bootstrap()
    print('資料表初始化完成。')
