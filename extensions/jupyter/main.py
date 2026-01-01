# main.py

# cal.py에서 Calculator 클래스를 가져옵니다.
from cal import Calculator

# 클래스 인스턴스를 생성하지 않고 바로 정적 메서드를 사용합니다.
result_add = Calculator.add(10, 5)
print(f"10 + 5 = {result_add}")

result_subtract = Calculator.subtract(10, 5)
print(f"10 - 5 = {result_subtract}")

result_multiply = Calculator.multiply(10, 5)
print(f"10 * 5 = {result_multiply}")

result_divide = Calculator.divide(10, 5)
print(f"10 / 5 = {result_divide}")

# 만약 대화형 계산기를 실행하고 싶다면, 인스턴스를 생성하고 run 메서드를 호출할 수 있습니다.
# calculator_instance = Calculator()
# calculator_instance.run()
